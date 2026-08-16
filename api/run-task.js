const Anthropic = require('@anthropic-ai/sdk');
const { chromium } = require('playwright-core');
const Browserbase = require('@browserbasehq/sdk').default;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { action, sessionId, goal, userApiKey, connectUrl, conversationHistory, plan, currentStep } = req.body;
    const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY;
    
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });

    // ACTION: create - start a new browser session
    if (action === 'create') {
      const session = await bb.sessions.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        browserSettings: {
          viewport: { width: 1280, height: 800 }
        }
      });
      
      // Get the live view URL for embedding
      const liveViewLink = await bb.sessions.debug(session.id);
      
      res.status(200).json({ 
        sessionId: session.id,
        connectUrl: session.connectUrl,
        liveViewUrl: liveViewLink.debuggerFullscreenUrl
      });
      return;
    }

    // ACTION: step - execute one agent step
    if (action === 'step') {
      const browser = await chromium.connectOverCDP(connectUrl);
      const context = browser.contexts()[0];
      const page = context.pages()[0] || await context.newPage();
      
      // Ensure viewport is set to avoid 0 width screenshot error
      try {
        await page.setViewportSize({ width: 1280, height: 800 });
      } catch(e) {
        console.log('Viewport set skipped:', e.message);
      }
      
      // Wait a moment for page to be ready
      await page.waitForTimeout(500);
      
      // Take screenshot
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 60 });
      const base64 = screenshotBuffer.toString('base64');
      
      // Ask AI for next action
      const client = new Anthropic({ apiKey });
      const systemPrompt = `You are OmnyGO, a QA testing browser agent. Look at the screenshot and decide the next action.
Respond with ONLY a JSON object:
{ "action": "navigate", "url": "https://...", "description": "..." }
{ "action": "click", "x": 100, "y": 200, "description": "..." }
{ "action": "type", "text": "...", "description": "..." }
{ "action": "scroll", "direction": "down", "description": "..." }
{ "action": "done", "result": "..." }
Current goal: ${goal}`;

      const messages = [...(conversationHistory || []), {
        role: 'user',
        content: [
          { type: 'text', text: 'Current screen. What is the next action?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } }
        ]
      }];

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      });

      let actionText = response.content[0].text.trim();
      const jsonMatch = actionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) actionText = jsonMatch[0];
      const agentAction = JSON.parse(actionText);

      // Execute the action
      let done = false;
      if (agentAction.action === 'navigate') {
        await page.goto(agentAction.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } else if (agentAction.action === 'click') {
        await page.mouse.click(agentAction.x, agentAction.y);
      } else if (agentAction.action === 'type') {
        await page.keyboard.type(agentAction.text);
      } else if (agentAction.action === 'scroll') {
        await page.mouse.wheel(0, agentAction.direction === 'down' ? 500 : -500);
      } else if (agentAction.action === 'done') {
        done = true;
      }

      // DO NOT close the browser here - it will terminate the Browserbase session
      // The connectOverCDP connection will be garbage collected
      // The Browserbase session stays alive for the next step

      res.status(200).json({ 
        agentAction, 
        done,
        assistantMessage: response.content[0].text
      });
      return;
    }

    // ACTION: end - close session
    if (action === 'end') {
      // Browserbase sessions auto-close
      res.status(200).json({ ended: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });

  } catch (error) {
    console.error('Run task error:', error);
    res.status(500).json({ error: error.message });
  }
};
