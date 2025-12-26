const express = require('express');
const { insertParent, insertProvider } = require('../db');

const router = express.Router();

const REQUIRED_PARENT_FIELDS = ['name', 'email', 'phone'];
const REQUIRED_PROVIDER_FIELDS = ['name', 'email', 'phone'];

function hasRequired(body, fields) {
  return fields.every((f) => body[f]);
}

router.post('/parent', async (req, res) => {
  console.log('Parent submission received:', req.body);
  
  if (!hasRequired(req.body, REQUIRED_PARENT_FIELDS)) {
    console.log('Missing fields. Required:', REQUIRED_PARENT_FIELDS, 'Received:', Object.keys(req.body));
    return res.status(400).json({ error: 'Missing required parent fields' });
  }

  const payload = {
    name: String(req.body.name || ''),
    email: String(req.body.email || ''),
    phone: String(req.body.phone || ''),
    children: req.body.children || null,
    meta: req.body.meta || {},
  };

  try{
    await insertParent(payload);
  }catch(err){
    console.error('Parent insert failed:', err);
  }
  return res.status(200).json({ message: 'Parent submission received', data: payload });
});

router.post('/provider', async (req, res) => {
  if (!hasRequired(req.body, REQUIRED_PROVIDER_FIELDS)) {
    return res.status(400).json({ error: 'Missing required provider fields' });
  }

  const payload = {
    name: String(req.body.name || ''),
    email: String(req.body.email || ''),
    phone: String(req.body.phone || ''),
    experience: req.body.experience || null,
    meta: req.body.meta || {},
  };

  try{
    await insertProvider(payload);
  }catch(err){
    console.error('Provider insert failed:', err);
  }
  return res.status(200).json({ message: 'Provider submission received', data: payload });
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
