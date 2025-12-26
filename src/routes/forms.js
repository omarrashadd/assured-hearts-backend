const express = require('express');

const router = express.Router();

const REQUIRED_PARENT_FIELDS = ['name', 'email', 'phone'];
const REQUIRED_PROVIDER_FIELDS = ['name', 'email', 'phone'];

function hasRequired(body, fields) {
  return fields.every((f) => body[f]);
}

router.post('/parent', (req, res) => {
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

  // TODO: Persist to database or send email/Slack notification.
  return res.status(200).json({ message: 'Parent submission received', data: payload });
});

router.post('/provider', (req, res) => {
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

  // TODO: Persist to database or send email/Slack notification.
  return res.status(200).json({ message: 'Provider submission received', data: payload });
});

module.exports = router;
