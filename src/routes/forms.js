const express = require('express');
const bcrypt = require('bcrypt');
const { createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild } = require('../db');

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

router.post('/children', async (req, res) => {
  console.log('Child demographics received:', { user_id: req.body.user_id, num_children: req.body.numChildren });
  
  if (!req.body.user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const { user_id, numChildren, frequency, preferredSchedule, specialNeeds } = req.body;
  
  // Collect ages from dynamic fields (child1Age, child2Age, etc.)
  const ages = [];
  for (let i = 1; i <= numChildren; i++) {
    const age = req.body[`child${i}Age`];
    if (age) ages.push(parseInt(age));
  }

  try{
    const childId = await insertChildProfile({
      user_id,
      ages,
      frequency,
      preferred_schedule: preferredSchedule,
      special_needs: specialNeeds
    });
    console.log('Child profile created:', childId, 'for user:', user_id);
    return res.status(200).json({ message: 'Child profile created', childId });
  }catch(err){
    console.error('Child profile create failed:', err);
    return res.status(500).json({ error: 'Failed to create child profile' });
  }
});

// Waitlist endpoint
router.post('/waitlist', async (req, res) => {
  const { email, city } = req.body || {};
  if(!email || !city){
    return res.status(400).json({ error: 'Email and city are required' });
  }
  try{
    const id = await insertWaitlistEntry({ email, city });
    console.log('Waitlist entry created:', id, 'for', email, 'in', city);
    return res.status(200).json({ message: 'Added to waitlist', id });
  }catch(err){
    console.error('Waitlist create failed:', err);
    return res.status(500).json({ error: 'Failed to add to waitlist' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password){
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try{
    const user = await findUserByEmail(email);
    if(!user || !user.password_hash){
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if(!ok){
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    return res.json({ userId: user.id, name: user.name, type: user.type, city: user.city, province: user.province });
  }catch(err){
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Parent dashboard: get parent profile + children
router.get('/parent/:user_id', async (req, res) => {
  const userId = parseInt(req.params.user_id);
  if(!userId || isNaN(userId)){
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  try{
    const profile = await getParentProfile(userId);
    if(!profile){
      return res.status(404).json({ error: 'Parent profile not found' });
    }
    const children = await getParentChildren(userId);
    return res.json({ profile, children });
  }catch(err){
    console.error('Parent dashboard fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Update child profile
router.put('/child/:child_id', async (req, res) => {
  const childId = parseInt(req.params.child_id);
  if(!childId || isNaN(childId)){
    return res.status(400).json({ error: 'Invalid child ID' });
  }
  try{
    const { name, ages, frequency, preferred_schedule, special_needs } = req.body;
    await updateChild({
      child_id: childId,
      name,
      ages,
      frequency,
      preferred_schedule,
      special_needs
    });
    return res.json({ message: 'Child profile updated', childId });
  }catch(err){
    console.error('Child update failed:', err);
    return res.status(500).json({ error: 'Failed to update child profile' });
  }
});

module.exports = router;

