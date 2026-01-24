console.log('DEPLOYMENT TEST: forms.js loaded');

const express = require('express');
const bcrypt = require('bcrypt');
const { createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions, getPendingApplications, getApplicationDetails, approveApplication, pool, getChildById, incrementReferralCount, getProviderProfile, getProviderSessions, getProviderStats, getProviderRequests, createSessionFromRequest, listProviders, getProviderIdForUser, insertMessage, getMessagesForUser, markMessagesRead } = require('../db');
const { calculatePricing, getPricingConfig } = require('../pricing');

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

  const { name, email, phone, password, age_groups, certifications, meta } = req.body;
  const first_name = req.body.first_name || req.body.firstName || meta?.first_name || null;
  const last_name = req.body.last_name || req.body.lastName || meta?.last_name || null;
  const computedName = name || [first_name, last_name].filter(Boolean).join(' ') || 'Caregiver';
  
  // Extract city/province from meta (frontend sends them there)
  const city = meta?.city || req.body.city || null;
  const province = meta?.province || req.body.province || null;
  const languages = meta?.languages || req.body.languages || null;
  const address_line1 = meta?.address_line1 || req.body.address_line1 || null;
  const address_line2 = meta?.address_line2 || req.body.address_line2 || null;
  const postal_code = meta?.postal_code || req.body.postal_code || null;
  const payout_method = meta?.payout_method || req.body.payout_method || null;
  const consent_background_check = meta?.consent_background_check ?? meta?.consentBackgroundCheck ?? req.body.consent_background_check ?? req.body.consentBackgroundCheck;
  const consent_terms = meta?.consent_terms ?? meta?.consentTerms ?? req.body.consent_terms ?? req.body.consentTerms;
  const consent_provider_agreement = meta?.consent_provider_agreement ?? meta?.consentProviderAgreement ?? req.body.consent_provider_agreement ?? req.body.consentProviderAgreement;
  
  console.log('Extracted location:', { city, province });
  
  try{
    // Create user account with city/province
    const userId = await createProviderUser({ name: computedName, email, phone, password, city, province });
    console.log('Provider user created:', userId, 'with location:', city, province);
    
    // Store application details
    await insertProviderApplication({
      user_id: userId,
      first_name,
      last_name,
      phone,
      city,
      province,
      address_line1,
      address_line2,
      postal_code,
      availability: meta?.availability,
      age_groups,
      certifications,
      languages,
      payout_method,
      consent_background_check: consent_background_check === true || consent_background_check === 'true' || consent_background_check === 1 || consent_background_check === '1',
      consent_terms: consent_terms === true || consent_terms === 'true' || consent_terms === 1 || consent_terms === '1',
      consent_provider_agreement: consent_provider_agreement === true || consent_provider_agreement === 'true' || consent_provider_agreement === 1 || consent_provider_agreement === '1'
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
    const resolvedId = await getProviderIdForUser(providerId) || providerId;
    let profile = await getProviderProfile(resolvedId);
    if(!profile){
      profile = { id: resolvedId, user_id: providerId, name: 'Caregiver', email: null, phone: null, city: null, province: null };
    }
    const sessions = await getProviderSessions(resolvedId);
    const stats = await getProviderStats(resolvedId);
    const requests = await getProviderRequests(resolvedId);
    // Fallback: treat accepted requests as pseudo-sessions for UI messaging
    const pseudoSessions = (requests || []).filter(r => (r.status||'').toLowerCase() === 'accepted').map(r => {
      const startDate = r.start_at ? new Date(r.start_at) : null;
      const endDate = r.end_at ? new Date(r.end_at) : null;
      return {
        id: `req-${r.id}`,
        parent_id: r.parent_id,
        parent_name: r.parent_name || 'Family',
        parent_city: r.location || '',
        session_date: startDate ? startDate.toISOString().slice(0,10) : null,
        start_time: startDate ? startDate.toTimeString().slice(0,8) : '',
        end_time: endDate ? endDate.toTimeString().slice(0,8) : '',
        status: r.status || 'accepted'
      };
    });
    const combinedSessions = [...sessions, ...pseudoSessions];
    return res.json({ profile, sessions: combinedSessions, stats, requests, messages: [], reviews: [] });
  }catch(err){
    console.error('Provider dashboard fetch failed:', err);
    return res.status(500).json({ error: 'Failed to fetch provider dashboard' });
  }
});

// Public list of providers (basic info)
router.get('/providers', async (req, res) => {
  try{
    const city = req.query?.city ? String(req.query.city).trim() : null;
    const province = req.query?.province ? String(req.query.province).trim() : null;
    const providers = await require('../db').listProviders({ city, province });
    return res.json({ providers });
  }catch(err){
    console.error('List providers failed:', err);
    return res.status(500).json({ error: 'Failed to list providers' });
  }
});

// Update provider profile
router.put('/provider/:provider_id', async (req, res) => {
  const providerId = parseInt(req.params.provider_id);
  if(!providerId || isNaN(providerId)) return res.status(400).json({ error: 'Invalid provider ID' });
  try{
    const updated = await updateProviderProfile(providerId, req.body || {});
    if(!updated) return res.status(404).json({ error: 'Provider not found' });
    return res.json({ profile: updated });
  }catch(err){
    console.error('Provider profile update failed:', err);
    return res.status(500).json({ error: 'Failed to update provider profile' });
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

// Messaging: fetch all messages for a user
router.get('/messages/:user_id', async (req, res) => {
  const userId = parseInt(req.params.user_id);
  if(!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
  try{
    const messages = await getMessagesForUser(userId);
    return res.json({ messages });
  }catch(err){
    console.error('Messages fetch failed:', err);
    // Fail open with empty list so chat doesn't break the UI
    return res.json({ messages: [] });
  }
});

// Messaging: send a message
router.post('/messages', async (req, res) => {
  const sender_id = parseInt(req.body?.sender_id, 10);
  const receiver_id = parseInt(req.body?.receiver_id, 10);
  const body = req.body?.body || '';
  if(!sender_id || !receiver_id){
    return res.status(400).json({ error: 'sender_id and receiver_id are required' });
  }
  try{
    const msg = await insertMessage({ sender_id, receiver_id, body });
    return res.json({ message: msg });
  }catch(err){
    console.error('Message send failed:', err.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// Messaging: mark thread as read
router.post('/messages/read', async (req, res) => {
  const { user_id, other_id } = req.body || {};
  if(!user_id || !other_id) return res.status(400).json({ error: 'user_id and other_id are required' });
  try{
    await markMessagesRead({ user_id, other_id });
    return res.json({ success: true });
  }catch(err){
    console.error('Mark read failed:', err);
    return res.status(500).json({ error: 'Failed to mark messages read' });
  }
});

// Create childcare request
router.post('/request', async (req, res) => {
  const { user_id, child_id, location, notes, childName, start_at, end_at, provider_id, care_type, is_premium, child_age } = req.body;
  console.log('Childcare request received:', { user_id, child_id, location, childName, start_at, end_at, provider_id, care_type, is_premium });
  
  if(!user_id || !location){
    return res.status(400).json({ error: 'user_id and location are required' });
  }
  
  try{
    // Verify user exists first
    const userExists = await getParentProfile(user_id);
    console.log('User exists check:', userExists ? 'YES' : 'NO', 'for user_id:', user_id);
    
    if(!userExists) {
      return res.status(404).json({ error: 'User not found. Please log in again.' });
    }
    
    let finalChildId = child_id ? parseInt(child_id) : null;
    let finalProviderId = provider_id ? parseInt(provider_id) : null;
    let resolvedChildAge = null;

    // If provider_id was sent as user_id, resolve to providers.id
    if(finalProviderId){
      const resolved = await getProviderIdForUser(finalProviderId);
      if(resolved) finalProviderId = resolved;
    }
    
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

    if(finalChildId){
      const childRecord = await getChildById(finalChildId);
      if(childRecord && Number.isFinite(Number(childRecord.age))){
        resolvedChildAge = Number(childRecord.age);
      }
    }
    if(resolvedChildAge === null || Number.isNaN(resolvedChildAge)){
      if(child_age !== undefined && child_age !== null && child_age !== ''){
        const parsedAge = Number(child_age);
        resolvedChildAge = Number.isFinite(parsedAge) ? parsedAge : null;
      }
    }
    
    const profileIsPremium = !!userExists?.is_premium;
    const resolvedCareType = profileIsPremium ? 'curriculum' : 'basic';
    const paymentStatus = 'unpaid';
    const pricingConfig = await getPricingConfig();
    const pricing = calculatePricing({
      age: resolvedChildAge,
      care_type: resolvedCareType,
      is_premium: profileIsPremium,
      start_at,
      end_at,
      province: userExists?.province || null
    }, pricingConfig);
    const id = await insertChildcareRequest({
      user_id,
      child_id: finalChildId,
      location,
      notes,
      start_at,
      end_at,
      care_type: resolvedCareType,
      is_premium: profileIsPremium,
      child_age: resolvedChildAge,
      pricing_province: userExists?.province || null,
      pricing_snapshot: pricing,
      hourly_rate_cents: pricing.total_hourly_cents,
      payment_amount_cents: pricing.total_booking_cents,
      provider_id: finalProviderId,
      payment_status: paymentStatus
    });
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

// Respond to a childcare request (caregiver)
router.post('/request/:id/respond', async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { action, provider_id } = req.body || {};
  if(!requestId || isNaN(requestId)) return res.status(400).json({ error: 'Invalid request ID' });
  if(!action || !['accept','decline','more_info'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try{
    const { rows } = await pool.query('SELECT * FROM childcare_requests WHERE id=$1', [requestId]);
    const reqRow = rows[0];
    if(!reqRow) return res.status(404).json({ error: 'Request not found' });
    // Resolve provider_id from either the request body (may be user_id) or existing row
    let finalProviderId = provider_id || reqRow.provider_id;
    if(!finalProviderId && provider_id){
      const resolved = await getProviderIdForUser(provider_id);
      finalProviderId = resolved || provider_id;
    } else if(finalProviderId && provider_id){
      const resolved = await getProviderIdForUser(provider_id);
      finalProviderId = resolved || finalProviderId;
    }

    if(action === 'accept'){
      await pool.query('UPDATE childcare_requests SET status=$1, provider_id=$2 WHERE id=$3', ['accepted', finalProviderId, requestId]);
      if(finalProviderId){
        try{
          await createSessionFromRequest({ parent_id: reqRow.parent_id, provider_id: finalProviderId, request: reqRow });
        }catch(err){
          console.warn('Create session failed:', err.message);
        }
      }
      if((reqRow.payment_status || '').toLowerCase() !== 'paid'){
        await pool.query('UPDATE childcare_requests SET payment_status=$1 WHERE id=$2', ['awaiting_payment', requestId]);
      }
      return res.json({ success:true, status:'accepted' });
    } else if(action === 'decline'){
      await pool.query('UPDATE childcare_requests SET status=$1 WHERE id=$2', ['declined', requestId]);
      return res.json({ success:true, status:'declined' });
    } else {
      await pool.query('UPDATE childcare_requests SET status=$1 WHERE id=$2', ['needs_info', requestId]);
      return res.json({ success:true, status:'needs_info' });
    }
  }catch(err){
    console.error('Request respond failed:', err);
    return res.status(500).json({ error: 'Failed to update request' });
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
