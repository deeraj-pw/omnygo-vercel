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
    const { goal, planStep, userApiKey } = req.body;
    const apiKey = userApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'No API key configured' });
      return;
    }
    
    const client = new Anthropic({ apiKey });
    
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 256,
      system: `You are a QA testing agent executing a test step. Given the 
overall goal and current step, describe in ONE short sentence (under 15 words) 
what action you are taking, as if actually performing it in a browser. 
Be specific and action-oriented. Just the sentence, no quotes.`,
      messages: [{ role: 'user', content: `Goal: ${goal}\nCurrent step: ${planStep}\nDescribe the action:` }]
    });
    
    const description = response.content[0].text.trim();
    res.status(200).json({ description });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
