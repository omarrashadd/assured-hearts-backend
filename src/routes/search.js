const express = require('express');
const { countProvidersByCity, pool } = require('../db');

const router = express.Router();

// GET /search?city=Toronto
router.get('/', async (req, res) => {
  const city = (req.query.city || '').trim();
  if(!city){
    return res.status(400).json({ error: 'city is required' });
  }
  try{
    if(!pool){
      return res.json({ caregivers: 0 });
    }
    const caregivers = await countProvidersByCity(city);
    return res.json({ caregivers });
  }catch(err){
    console.error('Search error:', err);
    return res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;