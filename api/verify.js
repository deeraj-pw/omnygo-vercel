const Anthropic = require('@anthropic-ai/sdk');

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
    const { goal, plan, userApiKey } = req.body;
    const apiKey = (req.body && req.body.userApiKey) || process.env.ANTHROPIC_API_KEY;
     console.log('API key present:', !!apiKey, 'from:', req.body?.userApiKey ? 'user' : 'env');
    if (!apiKey) {
      res.status(400).json({ 
       error: 'No API key available. Please add your Anthropic API key in Settings.' 
     });
      return;
    }
    
    const client = new Anthropic({ apiKey });
    
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      system: `You are a QA verification checker. Given a testing goal and the 
test plan that was executed, verify whether the plan adequately covers the goal. 
Respond with ONLY a JSON object:
{"verified": true/false, "confidence": "high/medium/low", "reason": "brief explanation of test coverage"}`,
      messages: [{ role: 'user', content: `Goal: ${goal}\nTest plan executed: ${JSON.stringify(plan)}\nVerify test coverage:` }]
    });
    
    let text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];
    const result = JSON.parse(text);
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
