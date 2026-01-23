const express = require('express');
const { calculatePricing, getPricingConfig, updatePricingConfig, DEFAULT_PRICING_CONFIG } = require('../pricing');

const router = express.Router();

router.get('/config', async (_req, res) => {
  try{
    const config = await getPricingConfig();
    return res.json({ config });
  }catch(err){
    console.error('Pricing config fetch failed:', err);
    return res.status(500).json({ error: 'Failed to load pricing config' });
  }
});

router.post('/config', async (req, res) => {
  try{
    const incoming = req.body?.config || req.body;
    if(!incoming || typeof incoming !== 'object'){
      return res.status(400).json({ error: 'Config payload is required' });
    }
    const saved = await updatePricingConfig(incoming);
    return res.json({ success: true, config: saved });
  }catch(err){
    console.error('Pricing config update failed:', err);
    return res.status(500).json({ error: 'Failed to update pricing config' });
  }
});

router.post('/calculate', async (req, res) => {
  try{
    const factors = req.body || {};
    const config = factors.config && typeof factors.config === 'object'
      ? factors.config
      : await getPricingConfig();
    const pricing = calculatePricing({
      age: factors.age,
      care_type: factors.care_type,
      is_premium: factors.is_premium,
      start_at: factors.start_at,
      end_at: factors.end_at,
      hours: factors.hours,
      province: factors.province
    }, config);
    return res.json({ pricing, config_version: config.version || DEFAULT_PRICING_CONFIG.version });
  }catch(err){
    console.error('Pricing calculation failed:', err);
    return res.status(500).json({ error: 'Failed to calculate pricing' });
  }
});

module.exports = router;
