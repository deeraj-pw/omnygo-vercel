require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const BrowserController = require('./browser');

class Agent {
  constructor(config, onStep) {
    this.provider = config.provider || 'anthropic';
    
    if (this.provider === 'anthropic') {
      this.client = new Anthropic({ apiKey: config.apiKey });
    } else if (this.provider === 'openai') {
      this.client = new OpenAI({ apiKey: config.apiKey });
    } else {
      throw new Error(`Unknown AI provider: ${this.provider}`);
    }
    
    this.browser = new BrowserController();
    this.onStep = onStep || console.log;
    this.conversationHistory = [];
    this.replyResolver = null;
    this.stopped = false;
    this.verificationAttempts = 0;
    this.reportData = {
      goal: '',
      startTime: null,
      endTime: null,
      steps: [],
      result: '',
      status: 'pending'
    };
  }

  normalizePlan(rawPlan) {
    if (!Array.isArray(rawPlan)) return [];
    return rawPlan.map(item => {
      if (typeof item === 'string') return item;
      // If it's an object, try common keys
      if (item && typeof item === 'object') {
        return item.step || item.title || item.description || 
               item.text || item.name || JSON.stringify(item);
      }
      return String(item);
    }).filter(s => s && s.length > 0);
  }

  buildMessagesForAPI() {
    // Keep all messages but strip screenshots from all but the last 2 turns
    const messages = [];
    let screenshotCount = 0;
    
    // Count total screenshots first
    let totalScreenshots = 0;
    for (const msg of this.conversationHistory) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image') totalScreenshots++;
        }
      }
    }
    
    // Rebuild history keeping only last 2 screenshots
    for (const msg of this.conversationHistory) {
      if (Array.isArray(msg.content)) {
        const newContent = [];
        for (const part of msg.content) {
          if (part.type === 'image') {
            screenshotCount++;
            // Only include if it's one of the last 2 screenshots
            if (screenshotCount > totalScreenshots - 2) {
              newContent.push(part);
            } else {
              // Replace old screenshot with a text placeholder
              newContent.push({ 
                type: 'text', 
                text: '[screenshot from previous step - removed to save context]' 
              });
            }
          } else {
            newContent.push(part);
          }
        }
        messages.push({ role: msg.role, content: newContent });
      } else {
        messages.push(msg);
      }
    }
    return messages;
  }

  async callAI(systemPrompt, messages) {
    if (this.provider === 'anthropic') {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      });
      return response.content[0].text;
    
    } else if (this.provider === 'openai') {
      // Convert messages from Anthropic format to OpenAI format
      const openaiMessages = [
  { 
    role: 'system', 
    content: `CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE EXACTLY:
You are OmnyGO, a browser automation agent. You are NOT a regular AI chatbot.
You control a REAL web browser right now. The screenshot shows what the browser sees.
You MUST respond with ONLY a valid JSON object - nothing else.
NEVER say "I'm unable to access websites" - you ARE accessing websites through the browser.
NEVER give instructions to the user about how to do something manually.
NEVER explain what you would do - just DO it by returning the correct JSON action.
If you see a login page, use the ask action to request credentials from the user.
If you see any webpage, analyze it and return the next JSON action to take.

${systemPrompt}`
  }
];
      
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          openaiMessages.push({
            role: msg.role,
            content: msg.content
          });
        } else if (Array.isArray(msg.content)) {
          // Convert Anthropic's content array to OpenAI format
          const parts = [];
          for (const part of msg.content) {
            if (part.type === 'text') {
              parts.push({ type: 'text', text: part.text });
            } else if (part.type === 'image') {
              parts.push({
                type: 'image_url',
                image_url: {
                  url: `data:${part.source.media_type};base64,${part.source.data}`,
                  detail: 'low'
                }
              });
            }
          }
          openaiMessages.push({
            role: msg.role,
            content: parts
          });
        }
      }
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 2000,
        messages: openaiMessages
      });
      return response.choices[0].message.content;
    }
  }

   async run(userGoal) {
     try {
       // Reset conversation history for new task
       this.conversationHistory = [];

         // Launch browser
         await this.browser.launch();
         this.onStep({ type: 'info', message: 'Browser launched' });
         
         // Signal UI to focus test browser after launch
         this.onStep({ type: 'focus_browser' });

         // Check if this is an ERP task
         const erpUrl = process.env.ERP_URL || '';
         const isERPTask = erpUrl && (
           userGoal.toLowerCase().includes('erp') ||
           userGoal.includes(erpUrl) ||
           userGoal.includes('bistrk') ||
           userGoal.includes('epicor') ||
           userGoal.includes('bistrack')
         );

         if (isERPTask) {
           this.onStep({ type: 'info', message: 'Preparing ERP session...' });
           
           // Try to load existing session first
           const sessionLoaded = await this.browser.loadSession();
           
           if (sessionLoaded) {
             // Navigate to ERP and check if still logged in
             await this.browser.page.goto(erpUrl, { 
               waitUntil: 'domcontentloaded', 
               timeout: 15000 
             });
             await this.browser.page.waitForTimeout(1000);
             const stillLoggedIn = await this.browser.isLoggedIn();
             
             if (stillLoggedIn) {
               this.onStep({ type: 'info', message: 'Using existing ERP session' });
             } else {
               // Session expired, login again
               this.onStep({ type: 'info', message: 'Session expired, logging in...' });
               await this.browser.loginToERP();
             }
           } else {
             // No session, fresh login
             this.onStep({ type: 'info', message: 'Logging into ERP...' });
             const loginSuccess = await this.browser.loginToERP();
             if (!loginSuccess) {
               this.onStep({ 
                 type: 'error', 
                 message: 'Could not log into ERP automatically. Please check credentials in .env file.' 
               });
               await this.browser.close();
               return;
             }
           }
           
           this.onStep({ type: 'info', message: 'ERP ready' });
         }

         // Take initial screenshot

        const screenshot = await this.browser.screenshot();
        this.onStep({ type: 'info', message: 'Initial screenshot taken' });

        // === PLANNING PHASE ===
       // Detect if this is a real browser task or just conversation
       const triviaCheck = userGoal.trim().toLowerCase();
       const isTrivial = triviaCheck.length < 15 && 
         ['hello', 'hi', 'hey', 'test', 'thanks', 'ok', 'yes', 'no'].some(w => 
           triviaCheck === w || triviaCheck.startsWith(w + ' '));

       let plan;
       if (isTrivial) {
         // Skip planning, just respond conversationally
         plan = ['Respond to your message'];
         this.onStep({ type: 'plan', steps: plan });
         this.onStep({ type: 'plan_progress', currentStep: 0, totalSteps: 1 });
       } else {
         // Normal planning
         this.onStep({ type: 'info', message: 'Planning approach...' });
         plan = await this.createPlan(userGoal);
         this.currentPlan = plan;
         this.currentPlanStep = 0;
         this.onStep({ type: 'plan', steps: plan });
         this.onStep({ type: 'plan_progress', currentStep: 0, totalSteps: plan.length });
       }

      // Add user goal as first message with screenshot
      this.conversationHistory.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please help me complete this task: ${userGoal}`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: screenshot.mimeType || 'image/jpeg',
              data: screenshot.base64
            }
          }
        ]
      });

        const systemPrompt = `You are OmnyGO, an autonomous browser agent. Your purpose is to navigate any website and complete tasks intelligently on behalf of the user.

You will receive screenshots of the browser and must decide the next action to take.

=== YOUR PLAN ===
You created this plan to complete the task:
${plan.map((step, i) => `${i + 1}. ${step}`).join('\n')}

You are currently on step ${this.currentPlanStep + 1}: "${plan[this.currentPlanStep] || 'completing task'}"

=== AVAILABLE ACTIONS ===
Respond with a single JSON object:

{ "action": "navigate", "url": "https://...", "description": "Going to the website", "planStep": 1 }
{ "action": "click", "x": 245, "y": 390, "description": "Clicking the search button", "planStep": 2 }
{ "action": "type", "text": "hello", "description": "Typing the search query", "planStep": 2 }
{ "action": "scroll", "direction": "down", "description": "Scrolling to see results", "planStep": 3 }
{ "action": "wait", "description": "Waiting for page to load", "planStep": 1 }
{ "action": "ask", "question": "What email address should I use?" }
{ "action": "done", "result": "Task completed. Here are the results..." }

=== RULES ===
- Always respond with a single JSON object, nothing else
- Always include a "description" field explaining WHAT you are doing in plain English
- Always include "planStep" (1-based number) indicating which plan step this action belongs to
- Look at the screenshot carefully before deciding
- NEVER fill in passwords, credit card numbers, or personal details without asking the user first
- For login pages: ALWAYS use "ask" to request credentials
- Use "ask" only when you truly cannot proceed without user input
- Use "done" when the task is fully complete
- Be autonomous - figure out navigation yourself by reading the UI
- Never get stuck - if one approach fails after 2 attempts, try a completely different approach
- If you hit a CAPTCHA or verification you cannot solve, use "ask" to tell the user
- If you notice you are repeating the same action, STOP and try a different approach
- When you move to a new stage of the plan, update the planStep number accordingly
- Before using "done", make sure you have ACTUALLY achieved the goal, not just navigated near it. Your work will be verified against the original goal by looking at the final screenshot.
- Only declare "done" when the goal is genuinely and visibly complete.`;

       let stepCount = 0;
       const maxSteps = 50;

       // Main loop
       while (stepCount < maxSteps) {
        if (this.stopped) {
          console.log('Agent stopped by user');
          try { await this.browser.close(); } catch(e) {}
          return 'Task stopped by user';
        }
        stepCount++;
        this.onStep({ type: 'info', message: `Step ${stepCount}/${maxSteps}` });

        // Update system prompt with current plan step
        const currentSystemPrompt = systemPrompt
          .replace(
            /You are currently on step \d+: ".*?"/,
            `You are currently on step ${this.currentPlanStep + 1}: "${plan[this.currentPlanStep] || 'completing task'}"`
          );

        // Call AI API
         const responseText = await this.callAI(currentSystemPrompt, this.buildMessagesForAPI());
         if (this.stopped) {
           try { await this.browser.close(); } catch(e) {}
           return 'Task stopped by user';
         }
         this.onStep({ type: 'claude_response', text: responseText });

         // Parse action
         const action = this.parseAction(responseText);
         this.onStep({ type: 'action', action });

        // Update plan step if provided
        if (action.planStep && action.planStep !== this.currentPlanStep + 1) {
          this.currentPlanStep = action.planStep - 1;
          this.onStep({ type: 'plan_progress', currentStep: this.currentPlanStep, totalSteps: plan.length });
        }

        // Handle ask action
        if (action.action === 'ask') {
          this.conversationHistory.push({
            role: 'assistant',
            content: responseText
          });
          // Focus dashboard first, then ask
          this.onStep({ type: 'focus_dashboard' });
          await new Promise(r => setTimeout(r, 300));
          this.onStep({ type: 'ask', question: action.question });
          const userReply = await this.waitForUserReply();

          this.conversationHistory.push({
            role: 'user',
            content: userReply
          });

          // Check if the user redirected the task - re-plan
          const replanPrompt = `The user originally asked: "${userGoal}"
Then during the task, when asked a question, they responded: "${userReply}"

Based on their response, has the task direction changed significantly? 
If yes, create a NEW plan. If no (they just provided info like a password 
or confirmation), respond with the word "SAME".

If creating a new plan, respond with ONLY a JSON array of plain text strings.
NOT objects. Each item must be a simple string.

CORRECT format:
["Open the website", "Search for the item", "Report findings"]

WRONG format (do NOT do this):
[{"step": "Open the website"}, {"title": "Search"}]

Each array item must be a plain string sentence, nothing else.

If the task is the same, respond with ONLY: SAME`;

          try {
            const replanResponse = await this.callAI(replanPrompt, [
              { role: 'user', content: 'Should the plan change?' }
            ]);
            
            if (!replanResponse.trim().toUpperCase().startsWith('SAME')) {
              // Parse new plan
              let planText = replanResponse.trim();
              const jsonMatch = planText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
              if (jsonMatch) planText = jsonMatch[1];
              const arrayMatch = planText.match(/\[[\s\S]*\]/);
              if (arrayMatch) planText = arrayMatch[0];
              const newPlan = this.normalizePlan(JSON.parse(planText));
              if (Array.isArray(newPlan) && newPlan.length > 0) {
                this.currentPlan = newPlan;
                this.currentPlanStep = 0;
                plan.length = 0;
                newPlan.forEach(s => plan.push(s));
                this.onStep({ type: 'plan', steps: newPlan });
                this.onStep({ type: 'plan_progress', currentStep: 0, totalSteps: newPlan.length });
              }
            }
          } catch(e) {
            console.error('Re-plan failed:', e);
          }

          continue;
        }

        // Handle done action — verify first
        if (action.action === 'done') {
          // Step 1: Show "checking my work"
          this.onStep({ type: 'verifying' });
          await new Promise(r => setTimeout(r, 300));
          
          // Step 2: Actually verify
          const verification = await this.verifyCompletion(userGoal, action.result);
          
          // Step 3: Show verification result
          this.onStep({ 
            type: 'verification', 
            verified: verification.verified,
            confidence: verification.confidence,
            reason: verification.reason
          });
          await new Promise(r => setTimeout(r, 300));
          
          if (verification.verified) {
            // Step 4: NOW show all done (LAST)
            this.onStep({ type: 'done', result: action.result, verified: true });
            this.reportData.result = action.result;
            this.reportData.status = 'passed';
            this.reportData.endTime = new Date().toISOString();
            try { if (typeof this.saveReport === 'function') await this.saveReport(); } catch(e){}
            await this.browser.close();
            return action.result;
          } else {
            // Verification failed handling (retry logic)
            if (this.verificationAttempts === undefined) this.verificationAttempts = 0;
            this.verificationAttempts++;
            
            if (this.verificationAttempts >= 2) {
              this.onStep({ 
                type: 'done', 
                result: action.result + ' (Note: could not fully verify. ' + verification.reason + ')',
                verified: false
              });
              this.reportData.result = action.result;
              this.reportData.status = 'passed';
              this.reportData.endTime = new Date().toISOString();
              try { if (typeof this.saveReport === 'function') await this.saveReport(); } catch(e){}
              await this.browser.close();
              return action.result;
            }
            
            this.conversationHistory.push({ role: 'assistant', content: responseText });
            this.conversationHistory.push({
              role: 'user',
              content: [{
                type: 'text',
                text: `Verification check: The task does not appear fully complete. ${verification.reason}. Please continue working to achieve: "${userGoal}". Do not say "done" until genuinely achieved.`
              }]
            });
            continue;
          }
        }

        // Check if stopped before executing action
        if (this.stopped) {
          console.log('Stopped before executing action');
          try { await this.browser.close(); } catch(e) {}
          return 'Task stopped by user';
        }

       // Execute action
         await this.executeAction(action);
         
         // Signal UI to focus test browser after action
         this.onStep({ type: 'focus_browser' });

         // Take screenshot
         const newScreenshot = await this.browser.screenshot();

         // Check if agent is stuck
         if (this.isStuck()) {
           this.onStep({ type: 'info', message: 'Detected repeated actions — trying a different approach' });
           // Add a message to conversation history to break the loop
           this.conversationHistory.push({
             role: 'user',
             content: [
               {
                 type: 'text',
                 text: 'WARNING: You seem to be stuck repeating the same action. The last 3 actions were identical. Please try a COMPLETELY different approach to achieve the current plan step. If you cannot proceed, use the "ask" action to request help from the user, or use "done" to report what you have accomplished so far.'
               }
             ]
           });
         }

         // Add to conversation history
         this.conversationHistory.push({
           role: 'assistant',
           content: responseText
         });

         this.conversationHistory.push({
           role: 'user',
           content: [
             {
               type: 'text',
               text: 'Here is the updated screenshot after the action:'
             },
             {
               type: 'image',
               source: {
                 type: 'base64',
                 media_type: newScreenshot.mimeType || 'image/jpeg',
                 data: newScreenshot.base64
               }
             }
           ]
         });
      }

      // Max steps exceeded
      this.onStep({ type: 'error', message: 'Max steps (50) exceeded. Task incomplete.' });
      await this.browser.close();
      return 'Agent reached maximum steps. Task may be incomplete.';
    } catch (error) {
      let friendlyMessage = 'Something went wrong while working on your task.';
      const errMsg = error.message || '';
      
      if (errMsg.includes('balance') || errMsg.includes('credit') || errMsg.includes('quota')) {
        friendlyMessage = 'The AI service is temporarily unavailable (account limit reached). Please try again later or contact support.';
      } else if (errMsg.includes('timeout')) {
        friendlyMessage = 'The task took too long and timed out. Please try a simpler task or try again.';
      } else if (errMsg.includes('rate') || errMsg.includes('429')) {
        friendlyMessage = 'Too many requests right now. Please wait a moment and try again.';
      } else if (errMsg.includes('network') || errMsg.includes('ENOTFOUND') || errMsg.includes('ECONNREFUSED')) {
        friendlyMessage = 'Network connection issue. Please check your internet and try again.';
      } else if (errMsg.includes('navigate') || errMsg.includes('net::')) {
        friendlyMessage = 'Could not load the website. It may be down or blocking automated access.';
      } else if (errMsg.includes('401') || errMsg.includes('authentication') || errMsg.includes('invalid x-api-key')) {
        friendlyMessage = 'AI service authentication failed. Please check the API key configuration.';
      }
      
      console.error('Task error (technical):', error.message);
      this.onStep({ type: 'error', message: friendlyMessage });
      try {
        await this.browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
      this.reportData.status = 'failed';
      this.reportData.endTime = new Date().toISOString();
      this.reportData.result = friendlyMessage;
      try {
        if (typeof this.saveReport === 'function') {
          await this.saveReport();
        }
      } catch(e) {
        console.error('saveReport failed:', e);
      }
      return friendlyMessage;
    }
  }

  waitForUserReply() {
    return new Promise((resolve, reject) => {
      let timeoutId;
      this.replyResolver = (text) => {
        clearTimeout(timeoutId);
        resolve(text);
      };
      timeoutId = setTimeout(() => {
        this.replyResolver = null;
        reject(new Error('User reply timeout (5 minutes)'));
      }, 5 * 60 * 1000);
    });
  }

  receiveUserReply(text) {
    if (this.replyResolver) {
      this.replyResolver(text);
      this.replyResolver = null;
      // Signal browser focus after reply
      this.onStep({ type: 'focus_browser' });
    }
  }


  parseAction(responseText) {
    try {
      // Try to extract JSON from the response
      let jsonStr = responseText.trim();

      // Handle markdown code blocks
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      // Try to find JSON object
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const action = JSON.parse(jsonStr);
      return action;
    } catch (error) {
      throw new Error(`Failed to parse action from AI response: ${error.message}\nResponse: ${responseText}`);
    }
  }

  async executeAction(action) {
    switch (action.action) {
      case 'navigate':
        this.onStep({ type: 'info', message: `Executing: navigate to ${action.url}` });
        await this.browser.navigate(action.url);
        await this.browser.waitForStable();
        break;

      case 'click':
        this.onStep({ type: 'info', message: `Executing: click at x:${action.x} y:${action.y}` });
        await this.browser.click(action.x, action.y);
        await this.browser.waitForStable();
        break;

      case 'type':
        this.onStep({ type: 'info', message: `Executing: type "${action.text}"` });
        await this.browser.type(action.text);
        break;

      case 'scroll':
        this.onStep({ type: 'info', message: `Executing: scroll ${action.direction}` });
        await this.browser.scroll(action.direction);
        await this.browser.waitForStable();
        break;

      case 'wait':
        this.onStep({ type: 'info', message: 'Executing: wait' });
        await this.browser.waitForStable();
        break;

      case 'ask':
      case 'done':
        // These are handled in the main loop
        break;

      default:
        throw new Error(`Unknown action: ${action.action}`);
    }
  }

  async verifyCompletion(goal, claimedResult) {
    try {
      // Take a fresh screenshot of the final state
      const screenshot = await this.browser.screenshot();
      
      const verifyPrompt = `You are a strict verification checker for OmnyGO.

The user's original goal was: "${goal}"

The agent claims it completed the task with this result:
"${claimedResult}"

Look at the current screenshot of the browser. Honestly verify whether 
the goal was ACTUALLY achieved based on what you see on screen.

Respond with ONLY a JSON object:
{
  "verified": true or false,
  "confidence": "high" or "medium" or "low",
  "reason": "Brief explanation of what you see and whether it matches the goal"
}

Be honest and strict. If the screenshot doesn't clearly show the goal 
was achieved, set verified to false. If the page shows an error, a login 
wall, or doesn't match what was claimed, set verified to false.`;

      const messages = [{
        role: 'user',
        content: [
          { type: 'text', text: verifyPrompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: screenshot.mimeType || 'image/jpeg',
              data: screenshot.base64
            }
          }
        ]
      }];

      const response = await this.callAI(
        'You are a strict, honest verification checker. Respond only with JSON.',
        messages
      );

      // Parse the verification result
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
      
      const result = JSON.parse(jsonStr);
      return {
        verified: result.verified === true,
        confidence: result.confidence || 'low',
        reason: result.reason || 'No reason provided'
      };
    } catch (error) {
      console.error('Verification failed:', error);
      // If verification itself fails, assume completed but with low confidence
      return { verified: true, confidence: 'low', reason: 'Could not verify automatically' };
    }
  }

  async createPlan(goal) {
    const planPrompt = `You are OmnyGO, an autonomous browser agent. 
The user wants you to complete this task: "${goal}"

Break this task into 3-7 clear high-level steps. Each step should be 
a meaningful stage of the task, not individual clicks.

Respond with ONLY a JSON array of plain text strings. NOT objects. 
Each item must be a simple string.

CORRECT format:
["Open the website", "Search for the item", "Report findings"]

WRONG format (do NOT do this):
[{"step": "Open the website"}, {"title": "Search"}]

Each array item must be a plain string sentence, nothing else.

Rules:
- Keep steps short and clear (under 10 words each)
- 3-7 steps maximum
- Each step should be a meaningful stage, not a single click
- If the task is very simple (like just opening a website), use 2-3 steps
- Do not include technical details like URLs or coordinates`;

    const response = await this.callAI(planPrompt, [
      { role: 'user', content: `Create a plan for: ${goal}` }
    ]);

    try {
      let planText = response.trim();
      // Handle markdown code blocks
      const jsonMatch = planText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) planText = jsonMatch[1];
      const arrayMatch = planText.match(/\[[\s\S]*\]/);
      if (arrayMatch) planText = arrayMatch[0];
      
      const plan = JSON.parse(planText);
      if (Array.isArray(plan) && plan.length > 0) {
        return this.normalizePlan(plan);
      }
    } catch(e) {
      console.error('Failed to parse plan:', e);
    }
    
    // Fallback plan if parsing fails
    return ['Start the task', 'Complete the main action', 'Verify and report results'];
  }

  isStuck() {
    const steps = this.reportData.steps;
    if (steps.length < 3) return false;
    
    const lastThree = steps.slice(-3);
    
    // Check if last 3 actions are identical type + same coordinates
    const allSameType = lastThree.every(s => s.action === lastThree[0].action);
    if (!allSameType) return false;
    
    // If all clicks at similar positions
    if (lastThree[0].action === 'click') {
      const allSamePos = lastThree.every(s => 
        Math.abs(s.details.x - lastThree[0].details.x) < 20 &&
        Math.abs(s.details.y - lastThree[0].details.y) < 20
      );
      if (allSamePos) return true;
    }
    
    // If all scrolls in same direction
    if (lastThree[0].action === 'scroll') {
      const allSameDir = lastThree.every(s => 
        s.details.direction === lastThree[0].details.direction
      );
      if (allSameDir) return true;
    }
    
    // If all waits
    if (lastThree[0].action === 'wait') return true;
    
    return false;
  }
}

module.exports = Agent;
