const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  // CORS headers
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
    const { goal, userApiKey } = req.body;
    
    if (!goal) {
      res.status(400).json({ error: 'Goal is required' });
      return;
    }
    
    // Use user's key if provided, otherwise use server key
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
      max_tokens: 1024,
      system: `You are OmnyGO, an AI-powered QA testing agent. Break down 
testing tasks into clear test steps. Respond with ONLY a JSON array of 
3-6 short strings, each a test step. Example:
["Navigate to the login page", "Enter test credentials", "Click login button", "Verify successful login", "Confirm dashboard loads"]
No explanation, just the JSON array.`,
      messages: [{ role: 'user', content: `Create a QA test plan for: ${goal}` }]
    });
    
    let planText = response.content[0].text.trim();
    const jsonMatch = planText.match(/\[[\s\S]*\]/);
    if (jsonMatch) planText = jsonMatch[0];
    const plan = JSON.parse(planText);
    
    res.status(200).json({ plan });
  } catch (error) {
    console.error('Plan error:', error);
    res.status(500).json({ error: error.message });
  }
};
