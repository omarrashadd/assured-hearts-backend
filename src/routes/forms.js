const express = require('express');
const { createParentUser, createProviderUser, insertProviderApplication } = require('../db');

const router = express.Router();

const REQUIRED_PARENT_FIELDS = ['name', 'email', 'phone', 'password'];
const REQUIRED_PROVIDER_FIELDS = ['name', 'email', 'phone', 'password'];

function hasRequired(body, fields) {
  return fields.every((f) => body[f]);
}

router.post('/parent', async (req, res) => {
  console.log('Parent signup received:', { name: req.body.name, email: req.body.email });
  
  if (!hasRequired(req.body, REQUIRED_PARENT_FIELDS)) {
    console.log('Missing fields. Required:', REQUIRED_PARENT_FIELDS, 'Received:', Object.keys(req.body));
    return res.status(400).json({ error: 'Missing required parent fields' });
  }

  const { name, email, phone, password, city, province } = req.body;
  
  try{
    const userId = await createParentUser({ name, email, phone, password, city, province });
    console.log('Parent user created:', userId);
    return res.status(200).json({ message: 'Parent account created', userId });
  }catch(err){
    console.error('Parent create failed:', err);
    if(err.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/provider', async (req, res) => {
  console.log('Provider signup received:', { name: req.body.name, email: req.body.email });
  
  if (!hasRequired(req.body, REQUIRED_PROVIDER_FIELDS)) {
    console.log('Missing fields. Required:', REQUIRED_PROVIDER_FIELDS, 'Received:', Object.keys(req.body));
    return res.status(400).json({ error: 'Missing required provider fields' });
  }

  const { name, email, phone, password, experience, age_groups, certifications, city, province, meta } = req.body;
  
  try{
    // Create user account
    const userId = await createProviderUser({ name, email, phone, password, city, province });
    console.log('Provider user created:', userId);
    
    // Store application details
    await insertProviderApplication({
      user_id: userId,
      experience,
      availability: meta?.availability,
      age_groups,
      certifications
    });
    console.log('Provider application created for user:', userId);
    
    return res.status(200).json({ message: 'Provider account and application created', userId });
  }catch(err){
    console.error('Provider create failed:', err);
    if(err.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

module.exports = router;

// Optional: simple stats endpoint to verify DB inserts
router.get('/stats', async (req, res) => {
  try{
    const { pool } = require('../db');
    if(!pool) return res.json({ parents: null, providers: null });
    const p = await pool.query('SELECT COUNT(*) AS c FROM parents');
    const r = await pool.query('SELECT COUNT(*) AS c FROM providers');
    return res.json({ parents: Number(p.rows[0].c), providers: Number(r.rows[0].c) });
  }catch(err){
    console.error('Stats error:', err);
    return res.status(500).json({ error: 'Stats failed' });
  }
});
