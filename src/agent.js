require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const BrowserController = require('./browser');

class Agent {
  constructor(apiKey, onStep) {
    this.client = new Anthropic({ apiKey });
    this.browser = new BrowserController();
    this.onStep = onStep || console.log;
    this.conversationHistory = [];
    this.replyResolver = null;
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

  async run(userGoal) {
    try {
      // Reset conversation history for new task
      this.conversationHistory = [];

       // Launch browser
       await this.browser.launch();
       this.onStep({ type: 'info', message: 'Browser launched' });
       
       // Signal UI to focus test browser after launch
       this.onStep({ type: 'focus_browser' });

       // Take initial screenshot

      const screenshot = await this.browser.screenshot();
      this.onStep({ type: 'info', message: 'Initial screenshot taken' });

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

       const systemPrompt = `You are OmnyGO, an autonomous browser agent built by your owner. Your purpose is to navigate any website and complete tasks intelligently on behalf of the user.

You will receive screenshots of the browser and must decide the next action to take.

You can perform these actions by responding with a JSON object:

{ "action": "navigate", "url": "https://..." }
{ "action": "click", "x": 245, "y": 390 }
{ "action": "type", "text": "hello world" }
{ "action": "scroll", "direction": "down" }
{ "action": "wait" }
{ "action": "ask", "question": "What should I use as the email body?" }
{ "action": "done", "result": "Task completed. Sales order SO-0042 created." }

Rules:
- Always respond with a single JSON object, nothing else
- Look at the screenshot carefully before deciding
- Use "ask" only when you truly cannot proceed without user input
- Use "done" when the task is fully complete
- Be autonomous - figure out navigation yourself by reading the UI
- If you see a form, fill it with sensible placeholder data unless user specified values
- Never get stuck - if one approach fails, try another
- After navigating, if the page appears blank or shows only "200-OK", it means the URL was blocked. Go back to the homepage and use the UI form instead
- For JavaScript-heavy sites like travel booking, e-commerce, or ERPs, always prefer clicking through the UI rather than constructing direct URLs`;

      let stepCount = 0;
      const maxSteps = 50;

      // Main loop
      while (stepCount < maxSteps) {
        stepCount++;
        this.onStep({ type: 'info', message: `Step ${stepCount}/${maxSteps}` });

        // Call Claude API
        const response = await this.client.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages: this.buildMessagesForAPI()
        });

        const responseText = response.content[0].text;
        this.onStep({ type: 'claude_response', text: responseText });

        // Parse action
        const action = this.parseAction(responseText);
        this.onStep({ type: 'action', action });

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
          continue;
        }

        // Handle done action
        if (action.action === 'done') {
          this.onStep({ type: 'done', result: action.result });
          await this.browser.close();
          return action.result;
        }

        // Execute action
        await this.executeAction(action);
        
        // Signal UI to focus test browser after action
        this.onStep({ type: 'focus_browser' });

        // Take screenshot

        const newScreenshot = await this.browser.screenshot();

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
      this.onStep({ type: 'error', message: error.message });
      try {
        await this.browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
      throw error;
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
      throw new Error(`Failed to parse action from Claude response: ${error.message}\nResponse: ${responseText}`);
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
}

module.exports = Agent;
