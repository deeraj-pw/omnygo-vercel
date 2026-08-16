module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ 
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    keyPrefix: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 6) : 'MISSING',
    allEnvKeys: Object.keys(process.env).filter(k => k.includes('ANTHROPIC') || k.includes('BROWSER'))
  });
};
