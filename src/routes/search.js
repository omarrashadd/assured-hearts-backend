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

// GET /search/list?city=Toronto&limit=3
router.get('/list', async (req, res) => {
  const city = (req.query.city || '').trim();
  const limit = Math.min(parseInt(req.query.limit || '3', 10) || 3, 10);
  if(!city){
    return res.status(400).json({ error: 'city is required' });
  }
  try{
    if(!pool){
      return res.json({ caregivers: [] });
    }
    const sql = `
      SELECT u.id, u.name, u.city, u.province,
             COALESCE(p.experience, '') AS experience,
             COALESCE(p.certifications, '') AS certifications
      FROM users u
      LEFT JOIN provider_applications p ON p.user_id = u.id
      WHERE u.type='provider' AND LOWER(u.city) = LOWER($1)
      ORDER BY u.created_at DESC
      LIMIT $2`;
    const { rows } = await pool.query(sql, [city, limit]);
    return res.json({ caregivers: rows });
  }catch(err){
    console.error('Search list error:', err);
    return res.status(500).json({ error: 'Search list failed' });
  }
});

module.exports = router;