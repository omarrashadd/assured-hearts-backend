const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if(!DATABASE_URL){
  console.warn('[DB] DATABASE_URL not set. Database features disabled.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function init(){
  if(!pool) return;
  
  const createUsers = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT,
      type TEXT NOT NULL DEFAULT 'parent',
      city TEXT,
      province TEXT,
      referrals_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createProviderApps = `
    CREATE TABLE IF NOT EXISTS provider_applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      experience TEXT,
      availability JSONB,
      age_groups JSONB,
      certifications TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createChildren = `
    CREATE TABLE IF NOT EXISTS children (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT,
      age INTEGER,
      frequency TEXT,
      preferred_schedule TEXT,
      special_needs TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createWaitlist = `
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      city TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createProviders = `
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      city TEXT,
      province TEXT,
      experience TEXT,
      certifications TEXT,
      age_groups JSONB,
      availability JSONB,
      approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createChildcareRequests = `
    CREATE TABLE IF NOT EXISTS childcare_requests (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      child_id INTEGER REFERENCES children(id) ON DELETE SET NULL,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      location TEXT NOT NULL,
      start_at TIMESTAMP WITH TIME ZONE,
      end_at TIMESTAMP WITH TIME ZONE,
      rate TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createSessions = `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      session_date DATE NOT NULL,
      start_time TIME,
      end_time TIME,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  try{
    await pool.query(createUsers);
    await pool.query(createProviderApps);
    await pool.query(createChildren);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0`);
    // Ensure new child columns exist for legacy tables
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS first_name TEXT`);
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS last_name TEXT`);
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS age INTEGER`);
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS frequency TEXT`);
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS preferred_schedule TEXT`);
    await pool.query(`ALTER TABLE children ADD COLUMN IF NOT EXISTS special_needs TEXT`);
    // Backfill first_name from legacy name column if present
    try{
      await pool.query(`UPDATE children SET first_name = COALESCE(first_name, name, 'Child') WHERE first_name IS NULL OR first_name = ''`);
    }catch(_err){
      // ignore if legacy name column does not exist
    }
    await pool.query(createWaitlist);
    await pool.query(createProviders);
    // Provider profile enrichment
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS address_line1 TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS address_line2 TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS postal_code TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS payout_method TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS payout_details TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS bio TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS rate TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS rate TEXT`);
    await pool.query(createChildcareRequests);
    await pool.query(createSessions);
    console.log('[DB] Tables ensured');
    
  }catch(err){
    console.error('[DB] Init failed', err);
  }
}

// Hash password helper
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function createParentUser({ name, email, phone, password, city, province }){
  if(!pool) return;
  const password_hash = password ? await hashPassword(password) : null;
  const sql = 'INSERT INTO users(name,email,phone,password_hash,type,city,province) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id';
  const params = [name, email, phone, password_hash, 'parent', city, province];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

async function createProviderUser({ name, email, phone, password, city, province }){
  if(!pool) return;
  const password_hash = password ? await hashPassword(password) : null;
  const sql = 'INSERT INTO users(name,email,phone,password_hash,type,city,province) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id';
  const params = [name, email, phone, password_hash, 'provider', city, province];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

async function insertProviderApplication({ user_id, experience, availability, age_groups, certifications }){
  if(!pool) return;
  const sql = 'INSERT INTO provider_applications(user_id,experience,availability,age_groups,certifications) VALUES($1,$2,$3,$4,$5) RETURNING id';
  const params = [user_id, experience || null, availability ? JSON.stringify(availability) : null, age_groups ? JSON.stringify(age_groups) : null, certifications || null];
  const result = await pool.query(sql, params);
  console.log('[DB] Provider application created:', result.rows[0]?.id, 'for user:', user_id);
  return result.rows[0]?.id;
}

async function insertChildProfile({ user_id, first_name, last_name, age, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = `
    INSERT INTO children(parent_id, first_name, last_name, age, frequency, preferred_schedule, special_needs)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `;
  const params = [
    user_id,
    first_name || 'Child',
    last_name || null,
    age !== undefined && age !== null && age !== '' ? Number(age) : null,
    frequency || null,
    preferred_schedule || null,
    special_needs || null
  ];
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function findUserByEmail(email){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, password_hash, type, city, province FROM users WHERE email=$1';
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function countProvidersByCity(city){
  if(!pool) return 0;
  const sql = "SELECT COUNT(*) AS c FROM providers WHERE LOWER(city) = LOWER($1)";
  const result = await pool.query(sql, [city]);
  return Number(result.rows[0]?.c || 0);
}

async function insertWaitlistEntry({ email, city }){
  if(!pool) return;
  const sql = 'INSERT INTO waitlist(email, city) VALUES($1, $2) RETURNING id';
  const result = await pool.query(sql, [email, city]);
  return result.rows[0]?.id;
}

async function getParentChildren(user_id){
  if(!pool) return [];
  const sql = `
    SELECT id, parent_id, COALESCE(first_name,'Child') as first_name, last_name, age, frequency, preferred_schedule, special_needs, created_at 
    FROM children 
    WHERE parent_id=$1 
    ORDER BY created_at DESC
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getParentProfile(user_id){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, city, province, referrals_count, created_at FROM users WHERE id=$1 AND type=\'parent\'';
  const result = await pool.query(sql, [user_id]);
  return result.rows[0] || null;
}

async function updateChild({ child_id, first_name, last_name, age, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = 'UPDATE children SET first_name=$1, last_name=$2, age=$3, frequency=$4, preferred_schedule=$5, special_needs=$6 WHERE id=$7';
  await pool.query(sql, [
    first_name || 'Child',
    last_name || null,
    age !== undefined && age !== null && age !== '' ? Number(age) : null,
    frequency || null,
    preferred_schedule || null,
    special_needs || null,
    child_id
  ]);
}

async function getChildById(child_id){
  if(!pool) return null;
  const sql = 'SELECT id, parent_id, COALESCE(first_name,\'Child\') as first_name, last_name, age, frequency, preferred_schedule, special_needs FROM children WHERE id=$1';
  try{
    const result = await pool.query(sql, [child_id]);
    return result.rows[0] || null;
  }catch(err){
    console.error('[DB] getChildById failed:', err.message);
    return null;
  }
}

async function incrementReferralCount(user_id){
  if(!pool) return null;
  const sql = 'UPDATE users SET referrals_count = COALESCE(referrals_count,0) + 1 WHERE id=$1 RETURNING referrals_count';
  try{
    const result = await pool.query(sql, [user_id]);
    return result.rows[0]?.referrals_count || null;
  }catch(err){
    // If column missing for some reason, add it and retry once
    if(err.code === '42703'){
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0`);
      const retry = await pool.query(sql, [user_id]);
      return retry.rows[0]?.referrals_count || null;
    }
    console.error('[DB] incrementReferralCount failed:', err.message);
    throw err;
  }
}

async function getOrCreateChild(user_id, childName){
  if(!pool) return null;
  
  // If a name is provided, try to find existing child with that name
  if(childName && childName.trim()){
    const findSql = 'SELECT id FROM children WHERE parent_id=$1 AND first_name=$2 LIMIT 1';
    const findResult = await pool.query(findSql, [user_id, childName.trim()]);
    if(findResult.rows.length > 0){
      return findResult.rows[0].id;
    }
    
    // Create new child with name
    const createSql = 'INSERT INTO children(parent_id, first_name) VALUES($1, $2) RETURNING id';
    const createResult = await pool.query(createSql, [user_id, childName.trim()]);
    return createResult.rows[0]?.id;
  }
  
  return null;
}

async function insertChildcareRequest({ user_id, child_id, location, notes, provider_id=null, start_at=null, end_at=null, rate=null }){
  if(!pool) return;
  console.log('[DB] Inserting childcare request:', { user_id, child_id, location, provider_id, start_at, end_at });
  const sql = 'INSERT INTO childcare_requests(parent_id, child_id, provider_id, location, notes, status, start_at, end_at, rate) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id';
  const result = await pool.query(sql, [user_id, child_id || null, provider_id || null, location, notes || null, 'pending', start_at || null, end_at || null, rate || null]);
  console.log('[DB] Request inserted with ID:', result.rows[0]?.id);
  return result.rows[0]?.id;
}

async function getParentRequests(user_id){
  if(!pool) return [];
  const sql = `
    SELECT cr.id, cr.child_id, cr.location, cr.status, cr.notes, cr.created_at,
           cr.start_at, cr.end_at, cr.rate, cr.provider_id,
           CONCAT_WS(' ', c.first_name, c.last_name) as child_name
    FROM childcare_requests cr
    LEFT JOIN children c ON cr.child_id = c.id
    WHERE cr.parent_id=$1 
    ORDER BY cr.created_at DESC
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getProviderRequests(provider_id){
  if(!pool) return [];
  const sql = `
    SELECT cr.id, cr.parent_id, cr.child_id, cr.location, cr.status, cr.notes, cr.created_at,
           cr.start_at, cr.end_at, cr.rate, cr.provider_id,
           u.name as parent_name
    FROM childcare_requests cr
    LEFT JOIN users u ON cr.parent_id = u.id
    WHERE cr.provider_id IS NULL OR cr.provider_id = $1
    ORDER BY cr.created_at DESC
  `;
  const result = await pool.query(sql, [provider_id]);
  return result.rows || [];
}

async function createSessionFromRequest({ parent_id, provider_id, request }){
  if(!pool) return null;
  const startBase = request?.start_at || request?.created_at;
  if(!startBase) return null;
  const start = new Date(startBase);
  const end = request.end_at ? new Date(request.end_at) : null;
  const session_date = start.toISOString().slice(0,10);
  const start_time = start.toTimeString().slice(0,8);
  const end_time = end ? end.toTimeString().slice(0,8) : null;
  const sql = `
    INSERT INTO sessions(parent_id, provider_id, session_date, start_time, end_time, status)
    VALUES($1,$2,$3,$4,$5,'confirmed')
    RETURNING id
  `;
  const result = await pool.query(sql, [parent_id, provider_id, session_date, start_time, end_time]);
  return result.rows[0]?.id || null;
}

async function getParentSessions(user_id){
  if(!pool) return [];
  const sql = `
    SELECT s.id, s.session_date, s.start_time, s.end_time, s.status, 
           p.name as provider_name, p.city as provider_city
    FROM sessions s
    LEFT JOIN providers p ON s.provider_id = p.id
    WHERE s.parent_id=$1 AND s.session_date >= CURRENT_DATE
    ORDER BY s.session_date ASC, s.start_time ASC
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getProviderProfile(provider_id){
  if(!pool) return null;
  const sql = `
    SELECT pr.id, pr.user_id, pr.name, pr.email, pr.phone, pr.city, pr.province,
           pr.address_line1, pr.address_line2, pr.postal_code,
           pr.payout_method, pr.payout_details, pr.two_factor_enabled, pr.paused,
           pr.bio, pr.rate
    FROM providers pr
    WHERE pr.id = $1 OR pr.user_id = $1
  `;
  const result = await pool.query(sql, [provider_id]);
  return result.rows[0] || null;
}

async function getProviderSessions(provider_id){
  if(!pool) return [];
  const sql = `
    SELECT s.id, s.session_date, s.start_time, s.end_time, s.status,
           u.name as parent_name, u.city as parent_city
    FROM sessions s
    LEFT JOIN users u ON s.parent_id = u.id
    WHERE s.provider_id = $1 AND s.session_date >= CURRENT_DATE
    ORDER BY s.session_date ASC, s.start_time ASC
  `;
  const result = await pool.query(sql, [provider_id]);
  return result.rows || [];
}

async function getProviderStats(provider_id){
  if(!pool) return { active:0, pending:0, hours_scheduled:0, hours_month:0, earnings:0, tips:0 };
  const stats = { active:0, pending:0, hours_scheduled:0, hours_month:0, earnings:0, tips:0 };
  try{
    const activeSql = `
      SELECT COUNT(*) AS c
      FROM sessions
      WHERE provider_id=$1 AND status NOT IN ('cancelled') AND session_date >= CURRENT_DATE
    `;
    const activeRes = await pool.query(activeSql, [provider_id]);
    stats.active = Number(activeRes.rows[0]?.c || 0);

    const hoursSchedSql = `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600.0),0) AS h
      FROM sessions
      WHERE provider_id=$1 AND session_date >= CURRENT_DATE
    `;
    const hsRes = await pool.query(hoursSchedSql, [provider_id]);
    stats.hours_scheduled = Number(hsRes.rows[0]?.h || 0).toFixed(1);

    const hoursMonthSql = `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600.0),0) AS h
      FROM sessions
      WHERE provider_id=$1 AND date_trunc('month', session_date) = date_trunc('month', CURRENT_DATE)
    `;
    const hmRes = await pool.query(hoursMonthSql, [provider_id]);
    stats.hours_month = Number(hmRes.rows[0]?.h || 0).toFixed(1);
  }catch(err){
    console.error('[DB] getProviderStats failed:', err.message);
  }
  return stats;
}

async function updateProviderProfile(provider_id, fields){
  if(!pool) return null;
  const {
    name, phone, email, city, province,
    address_line1, address_line2, postal_code,
    payout_method, payout_details,
    two_factor_enabled, paused, bio, rate
  } = fields;
  const sql = `
    UPDATE providers SET
      name = COALESCE($1, name),
      phone = COALESCE($2, phone),
      email = COALESCE($3, email),
      city = COALESCE($4, city),
      province = COALESCE($5, province),
      address_line1 = COALESCE($6, address_line1),
      address_line2 = COALESCE($7, address_line2),
      postal_code = COALESCE($8, postal_code),
      payout_method = COALESCE($9, payout_method),
      payout_details = COALESCE($10, payout_details),
      two_factor_enabled = COALESCE($11, two_factor_enabled),
      paused = COALESCE($12, paused),
      bio = COALESCE($13, bio),
      rate = COALESCE($14, rate)
    WHERE id=$15 OR user_id=$15
    RETURNING *
  `;
  const params = [
    name || null,
    phone || null,
    email || null,
    city || null,
    province || null,
    address_line1 || null,
    address_line2 || null,
    postal_code || null,
    payout_method || null,
    payout_details || null,
    typeof two_factor_enabled === 'boolean' ? two_factor_enabled : null,
    typeof paused === 'boolean' ? paused : null,
    bio || null,
    rate || null,
    provider_id
  ];
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function getPendingApplications(){
  if(!pool) return [];
  const sql = `
    SELECT pa.id, pa.user_id, u.name, u.email, u.phone, u.city, u.province,
           pa.experience, pa.certifications, pa.age_groups, pa.availability, pa.created_at
    FROM provider_applications pa
    JOIN users u ON pa.user_id = u.id
    WHERE u.type = 'provider'
    ORDER BY pa.created_at DESC
  `;
  const result = await pool.query(sql);
  return result.rows || [];
}

async function getApplicationDetails(applicationId){
  if(!pool) return null;
  const sql = `
    SELECT pa.id, pa.user_id, u.name, u.email, u.phone, u.city, u.province,
           pa.experience, pa.certifications, pa.age_groups, pa.availability, pa.created_at
    FROM provider_applications pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.id = $1
  `;
  const result = await pool.query(sql, [applicationId]);
  return result.rows[0] || null;
}

async function approveApplication(applicationId){
  if(!pool) return null;
  
  // Get application details
  const app = await getApplicationDetails(applicationId);
  if(!app) {
    console.log('[DB] Application not found:', applicationId);
    throw new Error('Application not found');
  }
  
  console.log('[DB] Approving application:', applicationId, 'for user:', app.user_id, app.name);
  
  // Ensure JSONB fields are properly formatted
  const ageGroupsJson = app.age_groups ? (typeof app.age_groups === 'string' ? app.age_groups : JSON.stringify(app.age_groups)) : null;
  const availabilityJson = app.availability ? (typeof app.availability === 'string' ? app.availability : JSON.stringify(app.availability)) : null;
  
  // Check if provider already exists for this user
  const checkSql = 'SELECT id FROM providers WHERE user_id = $1';
  const existing = await pool.query(checkSql, [app.user_id]);
  
  let providerId;
  
  if (existing.rows.length > 0) {
    // Update existing provider
    console.log('[DB] Updating existing provider:', existing.rows[0].id);
    const updateSql = `
      UPDATE providers SET
        name = $1, email = $2, phone = $3, city = $4, province = $5,
        experience = $6, certifications = $7, age_groups = $8::jsonb, 
        availability = $9::jsonb, approved_at = NOW()
      WHERE user_id = $10
      RETURNING id
    `;
    const result = await pool.query(updateSql, [
      app.name, app.email, app.phone, app.city, app.province,
      app.experience, app.certifications, ageGroupsJson, availabilityJson, app.user_id
    ]);
    providerId = result.rows[0]?.id;
  } else {
    // Insert new provider
    console.log('[DB] Creating new provider for user:', app.user_id);
    const insertSql = `
      INSERT INTO providers (user_id, name, email, phone, city, province, experience, certifications, age_groups, availability)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
      RETURNING id
    `;
    const result = await pool.query(insertSql, [
      app.user_id, app.name, app.email, app.phone, app.city, app.province,
      app.experience, app.certifications, ageGroupsJson, availabilityJson
    ]);
    providerId = result.rows[0]?.id;
  }
  
  console.log('[DB] Provider created/updated:', providerId);
  return providerId;
}

module.exports = { pool, init, createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, countProvidersByCity, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions, getPendingApplications, getApplicationDetails, approveApplication, getProviderProfile, getProviderSessions, getProviderStats, updateProviderProfile, getProviderRequests, createSessionFromRequest };
