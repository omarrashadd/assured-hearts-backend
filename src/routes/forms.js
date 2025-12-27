const express = require('express');
const bcrypt = require('bcrypt');
const { createParentUser, createProviderApplication, approveProviderApplication, getPendingProviderApplications, getProviderApplicationDetails, insertChildProfile, findParentByEmail, findProviderApplicationByEmail, findProviderByEmail, insertWaitlistEntry, getParentChildren, getParentProfile, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions } = require('../db');

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
    // Check if email already exists
    const existingParent = await findParentByEmail(email);
    const existingApp = await findProviderApplicationByEmail(email);
    const existingProvider = await findProviderByEmail(email);
    
    if(existingParent || existingApp || existingProvider) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
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
  console.log('Provider application received:', { name: req.body.name, email: req.body.email });
  
  if (!hasRequired(req.body, REQUIRED_PROVIDER_FIELDS)) {
    console.log('Missing fields. Required:', REQUIRED_PROVIDER_FIELDS, 'Received:', Object.keys(req.body));
    return res.status(400).json({ error: 'Missing required provider fields' });
  }

  const { name, email, phone, password, experience, experience_details, has_cpr, islamic_values, age_groups, city, province, meta } = req.body;
  
  try{
    // Check if email already exists anywhere
    const existingParent = await findParentByEmail(email);
    const existingApp = await findProviderApplicationByEmail(email);
    const existingProvider = await findProviderByEmail(email);
    
    if(existingParent || existingApp || existingProvider) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Create provider application (pending approval)
    const appId = await createProviderApplication({
      name,
      email,
      phone,
      password,
      experience,
      experience_details,
      has_cpr,
      islamic_values,
      age_groups,
      availability: meta?.availability,
      references: meta?.references,
      city,
      province
    });
    console.log('Provider application created:', appId);
    
    return res.status(200).json({ 
      message: 'Provider application submitted successfully. We will review your application and contact you soon.', 
      applicationId: appId 
    });
  }catch(err){
    console.error('Provider application create failed:', err);
    if(err.code === '23505') return res.status(400).json({ error: 'Email already in use' });
    return res.status(500).json({ error: 'Failed to submit application' });
  }
});

// Admin endpoint to get pending provider applications
router.get('/providers/applications/pending', async (req, res) => {
  try{
    const apps = await getPendingProviderApplications();
    return res.status(200).json({ applications: apps });
  }catch(err){
    console.error('Failed to get pending applications:', err);
    return res.status(500).json({ error: 'Failed to retrieve applications' });
  }
});

// Admin endpoint to approve a provider application
router.post('/providers/applications/:id/approve', async (req, res) => {
  const { id } = req.params;
  
  try{
    const appDetails = await getProviderApplicationDetails(id);
    if(!appDetails) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    const provider_id = await approveProviderApplication(id);
    console.log('Provider approved:', provider_id, 'from application:', id);
    
    return res.status(200).json({ 
      message: 'Provider approved and activated', 
      providerId: provider_id,
      providerName: appDetails.name
    });
  }catch(err){
    console.error('Provider approval failed:', err);
    return res.status(500).json({ error: 'Failed to approve provider' });
  }
});

router.post('/children', async (req, res) => {
  console.log('Child demographics received:', { user_id: req.body.user_id, num_children: req.body.numChildren });
  
  if (!req.body.user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const { user_id, name, numChildren, frequency, preferredSchedule, specialNeeds } = req.body;
  
  // Collect ages from dynamic fields (child1Age, child2Age, etc.)
  const ages = [];
  for (let i = 1; i <= numChildren; i++) {
    const age = req.body[`child${i}Age`];
    if (age) ages.push(parseInt(age));
  }

  try{
    const childId = await insertChildProfile({
      user_id,
      name,
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

// Parent dashboard: get parent profile + children + requests + sessions
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
    const requests = await getParentRequests(userId);
    const sessions = await getParentSessions(userId);
    return res.json({ profile, children, requests, sessions });
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

// Create childcare request
router.post('/request', async (req, res) => {
  try {
    const { user_id, child_id, location, notes, childName } = req.body;
    console.log('Request body:', { user_id, child_id, location, notes, childName });
    
    if(!user_id || !location){
      return res.status(400).json({ error: 'Missing required fields: user_id and location' });
    }
    
    // Get or create child if childName is provided
    let finalChildId = child_id ? parseInt(child_id) : null;
    if(childName && !finalChildId){
      console.log('Creating new child with name:', childName);
      finalChildId = await getOrCreateChild(user_id, childName);
      console.log('Created/found child ID:', finalChildId);
    }
    
    const id = await insertChildcareRequest({ user_id, child_id: finalChildId, location, notes });
    console.log('Created request ID:', id);
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error creating childcare request:', err);
    res.status(500).json({ error: 'Failed to create request: ' + err.message });
  }
});

module.exports = router;

