const express = require('express');

const router = express.Router();

const REQUIRED_PARENT_FIELDS = ['name', 'email', 'phone', 'children'];
const REQUIRED_PROVIDER_FIELDS = ['name', 'email', 'phone', 'experience'];

function hasRequired(body, fields) {
  return fields.every((f) => body[f]);
}

router.post('/parent', (req, res) => {
  if (!hasRequired(req.body, REQUIRED_PARENT_FIELDS)) {
    return res.status(400).json({ error: 'Missing required parent fields' });
  }

  // TODO: Persist to database or send email/Slack notification.
  return res.status(200).json({ message: 'Parent submission received' });
});

router.post('/provider', (req, res) => {
  if (!hasRequired(req.body, REQUIRED_PROVIDER_FIELDS)) {
    return res.status(400).json({ error: 'Missing required provider fields' });
  }

  // TODO: Persist to database or send email/Slack notification.
  return res.status(200).json({ message: 'Provider submission received' });
});

module.exports = router;
