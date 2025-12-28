console.log('DEPLOYMENT TEST: forms.js loaded');

const express = require('express');
const bcrypt = require('bcrypt');
const { createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions, getPendingApplications, getApplicationDetails, approveApplication, pool, getChildById, incrementReferralCount, getProviderProfile, getProviderSessions, getProviderStats } = require('../db');

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
  console.log('Provider signup received:', { 
    name: req.body.name, 
    email: req.body.email, 
    hasPassword: !!req.body.password,
    passwordLength: req.body.password?.length,
    meta: req.body.meta 
  });
  
  if (!hasRequired(req.body, REQUIRED_PROVIDER_FIELDS)) {
    console.log('Missing fields. Required:', REQUIRED_PROVIDER_FIELDS, 'Received:', Object.keys(req.body));
    return res.status(400).json({ error: 'Missing required provider fields' });
  }

  const { name, email, phone, password, experience, age_groups, certifications, meta } = req.body;
  
  // Extract city/province from meta (frontend sends them there)
  const city = meta?.city || req.body.city || null;
  const province = meta?.province || req.body.province || null;
  
  console.log('Extracted location:', { city, province });
  
  try{
    // Create user account with city/province
    const userId = await createProviderUser({ name, email, phone, password, city, province });
    console.log('Provider user created:', userId, 'with location:', city, province);
    
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
  console.log('Child create received:', { user_id: req.body.user_id, first_name: req.body.first_name, last_name: req.body.last_name, age: req.body.age });
  
  if (!req.body.user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const user_id = parseInt(req.body.user_id);
  if(!user_id || Number.isNaN(user_id)){
    return res.status(400).json({ error: 'Invalid user_id' });
  }
  const { first_name, last_name, age, frequency, preferredSchedule, specialNeeds } = req.body;

  try{
    const childRow = await insertChildProfile({
      user_id,
      first_name: first_name || req.body.childName || 'Child',
      last_name: last_name || null,
      age,
      frequency,
      preferred_schedule: preferredSchedule,
      special_needs: specialNeeds
    });
    console.log('Child profile created:', childRow?.id, 'for user:', user_id);
    return res.status(200).json({ message: 'Child profile created', childId: childRow?.id });
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
  if(!childId || isNaN(childId)) return res.status(400).json({ error: 'Invalid child ID' });
  try{
    const { first_name, last_name, age, frequency, preferredSchedule, specialNeeds } = req.body;
    await updateChild({
      child_id: childId,
      first_name,
      last_name,
      age,
      frequency,
      preferred_schedule: preferredSchedule,
      special_needs: specialNeeds
    });
    return res.json({ message: 'Child profile updated', childId });
  }catch(err){
    console.error('Child update failed:', err);
    return res.status(500).json({ error: 'Failed to update child profile' });
  }
});

// Get single child profile
router.get('/child/:child_id', async (req, res) => {
  const childId = parseInt(req.params.child_id);
  if(!childId || isNaN(childId)) return res.status(400).json({ error: 'Invalid child ID' });
  try{
    const child = await getChildById(childId);
    if(!child) return res.status(404).json({ error: 'Child not found' });
    return res.json(child);
  }catch(err){
    console.error('Child fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch child profile' });
  }
});

// Provider dashboard
router.get('/provider/:provider_id', async (req, res) => {
  const providerId = parseInt(req.params.provider_id);
  if(!providerId || isNaN(providerId)) return res.status(400).json({ error: 'Invalid provider ID' });
  try{
    let profile = await getProviderProfile(providerId);
    if(!profile){
      profile = { id: providerId, user_id: providerId, name: 'Caregiver', email: null, phone: null, city: null, province: null };
    }
    const sessions = await getProviderSessions(providerId);
    const stats = await getProviderStats(providerId);
    return res.json({ profile, sessions, stats, requests: [], messages: [], reviews: [] });
  }catch(err){
    console.error('Provider dashboard fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch provider dashboard' });
  }
});

// Record a referral for a parent
router.post('/referral', async (req, res) => {
  const userId = parseInt(req.body.user_id);
  if(!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
  try{
    const count = await incrementReferralCount(userId);
    if(count === null) return res.status(404).json({ error: 'Parent not found' });
    return res.json({ referrals_count: count });
  }catch(err){
    console.error('Referral record failed:', err);
    return res.status(500).json({ error: 'Failed to record referral' });
  }
});

// Create childcare request
router.post('/request', async (req, res) => {
  const { user_id, child_id, location, notes, childName } = req.body;
  console.log('Childcare request received:', { user_id, child_id, location, childName });
  
  if(!user_id || !location){
    return res.status(400).json({ error: 'user_id and location are required' });
  }
  
  try{
    // Verify user exists first
    const { getParentProfile } = require('../db');
    const userExists = await getParentProfile(user_id);
    console.log('User exists check:', userExists ? 'YES' : 'NO', 'for user_id:', user_id);
    
    if(!userExists) {
      return res.status(404).json({ error: 'User not found. Please log in again.' });
    }
    
    let finalChildId = child_id ? parseInt(child_id) : null;
    
    // If a new child name is provided and no child_id, create the child first
    if(childName && !finalChildId){
      console.log('Creating new child with name:', childName, 'for user:', user_id);
      finalChildId = await getOrCreateChild(user_id, childName);
      console.log('Created/found child ID:', finalChildId);
      
      // Verify the child was created with name
      const { getParentChildren } = require('../db');
      const verifyChildren = await getParentChildren(user_id);
      console.log('All children for user after creation:', verifyChildren);
    }
    
    const id = await insertChildcareRequest({ user_id, child_id: finalChildId, location, notes });
    console.log('Created childcare request ID:', id);
    return res.json({ success: true, id });
  }catch(err){
    console.error('Error creating childcare request:', err);
    return res.status(500).json({ error: 'Failed to create request: ' + err.message });
  }
});

// Cancel childcare request
router.post('/request/:id/cancel', async (req, res) => {
  const requestId = parseInt(req.params.id);
  if(!requestId || isNaN(requestId)){
    return res.status(400).json({ error: 'Invalid request ID' });
  }
  try{
    const { rows } = await pool.query('UPDATE childcare_requests SET status=$1 WHERE id=$2 RETURNING id', ['cancelled', requestId]);
    if(rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    return res.json({ success: true, id: requestId });
  }catch(err){
    console.error('Failed to cancel request:', err);
    return res.status(500).json({ error: 'Failed to cancel request' });
  }
});

// Admin: Get all pending provider applications
router.get('/admin/applications', async (req, res) => {
  try{
    const applications = await getPendingApplications();
    return res.json({ applications });
  }catch(err){
    console.error('Failed to get applications:', err);
    return res.status(500).json({ error: 'Failed to retrieve applications' });
  }
});

// Admin: Get specific application details
router.get('/admin/applications/:id', async (req, res) => {
  const appId = parseInt(req.params.id);
  if(!appId || isNaN(appId)){
    return res.status(400).json({ error: 'Invalid application ID' });
  }
  try{
    const application = await getApplicationDetails(appId);
    if(!application){
      return res.status(404).json({ error: 'Application not found' });
    }
    return res.json({ application });
  }catch(err){
    console.error('Failed to get application details:', err);
    return res.status(500).json({ error: 'Failed to retrieve application' });
  }
});

// Admin: Approve provider application
router.post('/admin/applications/:id/approve', async (req, res) => {
  const appId = parseInt(req.params.id);
  if(!appId || isNaN(appId)){
    return res.status(400).json({ error: 'Invalid application ID' });
  }
  try{
    const providerId = await approveApplication(appId);
    if(!providerId){
      return res.status(404).json({ error: 'Application not found or already approved' });
    }
    console.log('Provider approved:', providerId, 'from application:', appId);
    return res.json({ message: 'Provider approved', providerId });
  }catch(err){
    console.error('Failed to approve application:', err);
    return res.status(500).json({ error: 'Failed to approve application: ' + err.message });
  }
});

module.exports = router;
