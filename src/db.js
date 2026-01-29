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
      is_premium BOOLEAN DEFAULT false,
      referrals_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createProviderApps = `
    CREATE TABLE IF NOT EXISTS provider_applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      city TEXT,
      province TEXT,
      address_line1 TEXT,
      postal_code TEXT,
      availability JSONB,
      age_groups JSONB,
      certifications TEXT,
      about TEXT,
      photo_url TEXT,
      cpr_certified BOOLEAN DEFAULT false,
      caregiver_insurance BOOLEAN DEFAULT false,
      languages TEXT,
      payout_method TEXT,
      consent_background_check BOOLEAN DEFAULT false,
      consent_terms BOOLEAN DEFAULT false,
      consent_provider_agreement BOOLEAN DEFAULT false,
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
      id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT,
      last_name TEXT,
      address_line1 TEXT,
      postal_code TEXT,
      payout_method TEXT,
      certifications TEXT,
      about TEXT,
      photo_url TEXT,
      cpr_certified BOOLEAN DEFAULT false,
      caregiver_insurance BOOLEAN DEFAULT false,
      age_groups JSONB,
      availability JSONB,
      languages TEXT,
      consent_background_check BOOLEAN DEFAULT false,
      consent_terms BOOLEAN DEFAULT false,
      consent_provider_agreement BOOLEAN DEFAULT false,
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
      care_type TEXT,
      is_premium BOOLEAN,
      child_age INTEGER,
      pricing_province TEXT,
      pricing_snapshot JSONB,
      hourly_rate_cents INTEGER,
      notes TEXT,
      payment_intent_id TEXT,
      payment_status TEXT,
      payment_amount_cents INTEGER,
      payment_currency TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createPricingConfig = `
    CREATE TABLE IF NOT EXISTS pricing_config (
      id INTEGER PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
    await pool.query(`ALTER TABLE provider_applications DROP COLUMN IF EXISTS experience`);
    await pool.query(`ALTER TABLE provider_applications DROP COLUMN IF EXISTS experience_details`);
    await pool.query(`ALTER TABLE provider_applications DROP COLUMN IF EXISTS daily_payouts_member`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS languages TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS first_name TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS last_name TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS phone TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS city TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS province TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS address_line1 TEXT`);
    await pool.query(`ALTER TABLE provider_applications DROP COLUMN IF EXISTS address_line2`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS postal_code TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS payout_method TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS about TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS cpr_certified BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS caregiver_insurance BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS consent_background_check BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS consent_terms BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE provider_applications ADD COLUMN IF NOT EXISTS consent_provider_agreement BOOLEAN DEFAULT false`);
    await pool.query(createChildren);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false`);
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
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS experience`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS experience_details`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS has_cpr`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS islamic_values`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS provider_references`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS payout_details`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS two_factor_enabled`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS paused`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS bio`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS rate`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS weekly_hours`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS rating`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS ratings`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS user_id`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS name`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS email`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS phone`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS city`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS province`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS password_hash`);
    await pool.query(`ALTER TABLE providers DROP COLUMN IF EXISTS address_line2`);
    // Provider profile columns
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS first_name TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_name TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS address_line1 TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS postal_code TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS payout_method TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS about TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS cpr_certified BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS caregiver_insurance BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS consent_background_check BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS consent_terms BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS consent_provider_agreement BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS languages TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE childcare_requests DROP COLUMN IF EXISTS rate`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS care_type TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS is_premium BOOLEAN`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS child_age INTEGER`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS pricing_province TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS hourly_rate_cents INTEGER`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS payment_status TEXT`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS payment_amount_cents INTEGER`);
    await pool.query(`ALTER TABLE childcare_requests ADD COLUMN IF NOT EXISTS payment_currency TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      attachment_url TEXT,
      attachment_name TEXT,
      attachment_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ
    )`);
    await pool.query(createChildcareRequests);
    await pool.query(createSessions);
    await pool.query(createPricingConfig);
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

async function insertProviderApplication({ user_id, first_name, last_name, phone, city, province, address_line1, postal_code, availability, age_groups, certifications, about, photo_url, cpr_certified, caregiver_insurance, languages, payout_method, consent_background_check, consent_terms, consent_provider_agreement }){
  if(!pool) return;
  const sql = `INSERT INTO provider_applications(
      user_id, first_name, last_name, phone, city, province,
      address_line1, postal_code,
      availability, age_groups, certifications, about, photo_url, cpr_certified, caregiver_insurance, languages, payout_method,
      consent_background_check, consent_terms, consent_provider_agreement
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    ) RETURNING id`;
  const params = [
    user_id,
    first_name || null,
    last_name || null,
    phone || null,
    city || null,
    province || null,
    address_line1 || null,
    postal_code || null,
    availability ? JSON.stringify(availability) : null,
    age_groups ? JSON.stringify(age_groups) : null,
    certifications || null,
    about || null,
    photo_url || null,
    cpr_certified === true,
    caregiver_insurance === true,
    languages || null,
    payout_method || null,
    consent_background_check === true,
    consent_terms === true,
    consent_provider_agreement === true
  ];
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
  const sql = 'SELECT id, name, email, phone, password_hash, type, city, province, is_premium FROM users WHERE email=$1';
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function countProvidersByCity(city){
  if(!pool) return 0;
  const sql = `
    SELECT COUNT(*) AS c
    FROM providers pr
    JOIN users u ON pr.id = u.id
    WHERE LOWER(u.city) = LOWER($1)
  `;
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
  const sql = 'SELECT id, name, email, phone, city, province, is_premium, referrals_count, created_at FROM users WHERE id=$1 AND type=\'parent\'';
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

async function insertChildcareRequest({ user_id, child_id, location, notes, provider_id=null, start_at=null, end_at=null, care_type=null, is_premium=null, child_age=null, pricing_province=null, pricing_snapshot=null, hourly_rate_cents=null, payment_amount_cents=null, payment_status=null }){
  if(!pool) return;
  console.log('[DB] Inserting childcare request:', { user_id, child_id, location, provider_id, start_at, end_at, care_type, is_premium });
  const sql = `INSERT INTO childcare_requests(
      parent_id, child_id, provider_id, location, notes, status, start_at, end_at,
      care_type, is_premium, child_age, pricing_province, pricing_snapshot,
      hourly_rate_cents, payment_amount_cents, payment_status
    ) VALUES(
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14
    ) RETURNING id`;
  const result = await pool.query(sql, [
    user_id,
    child_id || null,
    provider_id || null,
    location,
    notes || null,
    'pending',
    start_at || null,
    end_at || null,
    care_type || null,
    is_premium === null || is_premium === undefined ? null : !!is_premium,
    child_age !== null && child_age !== undefined ? Number(child_age) : null,
    pricing_province || null,
    pricing_snapshot || null,
    hourly_rate_cents !== null && hourly_rate_cents !== undefined ? Number(hourly_rate_cents) : null,
    payment_amount_cents !== null && payment_amount_cents !== undefined ? Number(payment_amount_cents) : null,
    payment_status || null
  ]);
  console.log('[DB] Request inserted with ID:', result.rows[0]?.id);
  return result.rows[0]?.id;
}

async function getParentRequests(user_id){
  if(!pool) return [];
  const sql = `
    SELECT cr.id, cr.child_id, cr.location, cr.status, cr.notes, cr.created_at,
           cr.start_at, cr.end_at, cr.provider_id,
           cr.care_type, cr.is_premium, cr.child_age, cr.pricing_province, cr.pricing_snapshot, cr.hourly_rate_cents,
           cr.payment_intent_id, cr.payment_status, cr.payment_amount_cents, cr.payment_currency,
           pr.id as provider_user_id,
           CONCAT_WS(' ', c.first_name, c.last_name) as child_name,
           COALESCE(NULLIF(CONCAT_WS(' ', pr.first_name, pr.last_name), ''), pu.name) as provider_name
    FROM childcare_requests cr
    LEFT JOIN children c ON cr.child_id = c.id
    LEFT JOIN providers pr ON cr.provider_id = pr.id
    LEFT JOIN users pu ON pr.id = pu.id
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
           cr.start_at, cr.end_at, cr.provider_id,
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
           pr.id as provider_id, pr.id as provider_user_id,
           COALESCE(NULLIF(CONCAT_WS(' ', pr.first_name, pr.last_name), ''), pu.name) as provider_name,
           pu.city as provider_city
    FROM sessions s
    LEFT JOIN providers pr ON s.provider_id = pr.id
    LEFT JOIN users pu ON pr.id = pu.id
    WHERE s.parent_id=$1 AND s.session_date >= CURRENT_DATE
    ORDER BY s.session_date ASC, s.start_time ASC
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

// Messaging
async function insertMessage({ sender_id, receiver_id, body }){
  if(!pool) return null;
  const safeBody = body || '';
  const sql = `INSERT INTO messages(sender_id, receiver_id, body) VALUES($1,$2,$3) RETURNING id, created_at`;
  const res = await pool.query(sql, [sender_id, receiver_id, safeBody]);
  return res.rows[0] || null;
}

async function markMessagesRead({ user_id, other_id }){
  if(!pool) return;
  const sql = `
    UPDATE messages
    SET read_at = NOW()
    WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL
  `;
  await pool.query(sql, [user_id, other_id]);
}

async function getMessagesForUser(user_id){
  if(!pool) return [];
  const sql = `
    SELECT m.id, m.sender_id, m.receiver_id, m.body, m.created_at, m.read_at,
           CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END AS other_id,
           u.name AS other_name
    FROM messages m
    JOIN users u ON u.id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
    WHERE m.sender_id = $1 OR m.receiver_id = $1
    ORDER BY m.created_at ASC
  `;
  const res = await pool.query(sql, [user_id]);
  return res.rows || [];
}

async function getProviderProfile(user_id){
  if(!pool) return null;
  const sql = `
    SELECT u.id,
           u.id AS provider_id,
           COALESCE(NULLIF(CONCAT_WS(' ', pr.first_name, pr.last_name), ''), u.name) AS name,
           u.email, u.phone, u.city, u.province,
           pr.first_name, pr.last_name,
           pr.address_line1, pr.postal_code, pr.payout_method,
           pr.availability, pr.languages, pr.certifications, pr.about, pr.photo_url,
           pr.cpr_certified, pr.caregiver_insurance, pr.age_groups,
           pr.consent_background_check, pr.consent_terms, pr.consent_provider_agreement,
           pr.approved_at, pr.created_at,
           (pr.id IS NOT NULL) AS approved
    FROM users u
    LEFT JOIN providers pr ON pr.id = u.id
    WHERE u.id = $1 AND u.type = 'provider'
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows[0] || null;
}

async function getProviderIdForUser(user_id){
  if(!pool) return null;
  const sql = 'SELECT id FROM providers WHERE id=$1 LIMIT 1';
  const result = await pool.query(sql, [user_id]);
  return result.rows[0]?.id || null;
}

async function listProviders({ city = null, province = null } = {}){
  if(!pool) return [];
  const conditions = [];
  const params = [];
  if(city){
    params.push(city);
    conditions.push(`LOWER(u.city) = LOWER($${params.length})`);
  }
  if(province){
    params.push(province);
    conditions.push(`LOWER(u.province) = LOWER($${params.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT pr.id,
           u.id AS user_id,
           COALESCE(NULLIF(CONCAT_WS(' ', pr.first_name, pr.last_name), ''), u.name) AS name,
           u.city, u.province,
           pr.availability, pr.languages, pr.certifications, pr.age_groups
    FROM providers pr
    JOIN users u ON pr.id = u.id
    ${whereClause}
    ORDER BY pr.created_at DESC
    LIMIT 50
  `;
  const result = await pool.query(sql, params);
  return result.rows || [];
}

async function getProviderSessions(provider_id){
  if(!pool) return [];
  const sql = `
    SELECT s.id, s.session_date, s.start_time, s.end_time, s.status,
           u.id as parent_id, u.name as parent_name, u.city as parent_city
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

async function updateProviderProfile(user_id, fields){
  if(!pool) return null;
  const {
    name, phone, city, province,
    address_line1, postal_code,
    first_name, last_name,
    payout_method,
    consent_background_check, consent_terms, consent_provider_agreement,
    availability, languages, certifications, about, photo_url, cpr_certified, caregiver_insurance, age_groups
  } = fields;
  const computedName = name || [first_name, last_name].filter(Boolean).join(' ') || null;
  const availabilityJson = availability ? (typeof availability === 'string' ? availability : JSON.stringify(availability)) : null;
  const ageGroupsJson = age_groups ? (typeof age_groups === 'string' ? age_groups : JSON.stringify(age_groups)) : null;
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        city = COALESCE($3, city),
        province = COALESCE($4, province)
       WHERE id = $5`,
      [computedName, phone || null, city || null, province || null, user_id]
    );
    const providerResult = await client.query(
      `UPDATE providers SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        address_line1 = COALESCE($3, address_line1),
        postal_code = COALESCE($4, postal_code),
        payout_method = COALESCE($5, payout_method),
        certifications = COALESCE($6, certifications),
        availability = COALESCE($7::jsonb, availability),
        languages = COALESCE($8, languages),
        about = COALESCE($9, about),
        photo_url = COALESCE($10, photo_url),
        cpr_certified = COALESCE($11, cpr_certified),
        caregiver_insurance = COALESCE($12, caregiver_insurance),
        age_groups = COALESCE($13::jsonb, age_groups),
        consent_background_check = COALESCE($14, consent_background_check),
        consent_terms = COALESCE($15, consent_terms),
        consent_provider_agreement = COALESCE($16, consent_provider_agreement)
       WHERE id = $17
       RETURNING id`,
      [
        first_name || null,
        last_name || null,
        address_line1 || null,
        postal_code || null,
        payout_method || null,
        certifications || null,
        availabilityJson,
        languages || null,
        about || null,
        photo_url || null,
        typeof cpr_certified === 'boolean' ? cpr_certified : null,
        typeof caregiver_insurance === 'boolean' ? caregiver_insurance : null,
        ageGroupsJson,
        typeof consent_background_check === 'boolean' ? consent_background_check : null,
        typeof consent_terms === 'boolean' ? consent_terms : null,
        typeof consent_provider_agreement === 'boolean' ? consent_provider_agreement : null,
        user_id
      ]
    );
    if(!providerResult.rows[0]){
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return getProviderProfile(user_id);
  }catch(err){
    await client.query('ROLLBACK');
    throw err;
  }finally{
    client.release();
  }
}

async function getPendingApplications(){
  if(!pool) return [];
  const sql = `
    SELECT pa.id, pa.user_id, u.name, u.email, u.phone, u.city, u.province,
           pa.first_name, pa.last_name, pa.phone, pa.city, pa.province,
           pa.address_line1, pa.postal_code,
           pa.certifications, pa.about, pa.photo_url, pa.cpr_certified, pa.caregiver_insurance,
           pa.languages, pa.age_groups, pa.availability, pa.payout_method,
           pa.consent_background_check, pa.consent_terms, pa.consent_provider_agreement,
           pa.created_at
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
           pa.first_name, pa.last_name, pa.phone, pa.city, pa.province,
           pa.address_line1, pa.postal_code,
           pa.certifications, pa.about, pa.photo_url, pa.cpr_certified, pa.caregiver_insurance,
           pa.languages, pa.age_groups, pa.availability, pa.payout_method,
           pa.consent_background_check, pa.consent_terms, pa.consent_provider_agreement,
           pa.created_at
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
  const displayName = app.name || [app.first_name, app.last_name].filter(Boolean).join(' ') || 'Caregiver';
  const splitName = (raw => {
    if(!raw) return { first: null, last: null };
    const parts = String(raw).trim().split(/\s+/);
    if(parts.length === 1) return { first: parts[0], last: null };
    const first = parts.shift();
    return { first, last: parts.join(' ') || null };
  })(displayName);
  const firstNameFinal = app.first_name || splitName.first;
  const lastNameFinal = app.last_name || splitName.last;
  
  await pool.query(
    `UPDATE users SET
      name = COALESCE($1, name),
      email = COALESCE($2, email),
      phone = COALESCE($3, phone),
      city = COALESCE($4, city),
      province = COALESCE($5, province)
     WHERE id = $6`,
    [displayName, app.email, app.phone, app.city, app.province, app.user_id]
  );

  // Check if provider already exists for this user
  const checkSql = 'SELECT id FROM providers WHERE id = $1';
  const existing = await pool.query(checkSql, [app.user_id]);
  
  let providerId;
  
  if (existing.rows.length > 0) {
    // Update existing provider
    console.log('[DB] Updating existing provider:', existing.rows[0].id);
    const updateSql = `
      UPDATE providers SET
        first_name = $1, last_name = $2,
        address_line1 = $3, postal_code = $4,
        payout_method = $5,
        certifications = $6, about = $7, photo_url = $8,
        cpr_certified = $9, caregiver_insurance = $10,
        age_groups = $11::jsonb, availability = $12::jsonb, languages = $13,
        consent_background_check = $14, consent_terms = $15, consent_provider_agreement = $16,
        approved_at = NOW()
      WHERE id = $17
      RETURNING id
    `;
    const result = await pool.query(updateSql, [
      firstNameFinal || null, lastNameFinal || null,
      app.address_line1 || null, app.postal_code || null,
      app.payout_method || null,
      app.certifications, app.about || null, app.photo_url || null,
      app.cpr_certified === true, app.caregiver_insurance === true,
      ageGroupsJson, availabilityJson, app.languages || null,
      app.consent_background_check === true, app.consent_terms === true, app.consent_provider_agreement === true,
      app.user_id
    ]);
    providerId = result.rows[0]?.id;
  } else {
    // Insert new provider
    console.log('[DB] Creating new provider for user:', app.user_id);
    const insertSql = `
      INSERT INTO providers (
        id, first_name, last_name,
        address_line1, postal_code, payout_method,
        certifications, about, photo_url, cpr_certified, caregiver_insurance,
        age_groups, availability, languages,
        consent_background_check, consent_terms, consent_provider_agreement
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17)
      RETURNING id
    `;
    const result = await pool.query(insertSql, [
      app.user_id, firstNameFinal || null, lastNameFinal || null,
      app.address_line1 || null, app.postal_code || null, app.payout_method || null,
      app.certifications, app.about || null, app.photo_url || null,
      app.cpr_certified === true, app.caregiver_insurance === true,
      ageGroupsJson, availabilityJson, app.languages || null,
      app.consent_background_check === true, app.consent_terms === true, app.consent_provider_agreement === true
    ]);
    providerId = result.rows[0]?.id;
  }
  
  console.log('[DB] Provider created/updated:', providerId);
  return providerId;
}

module.exports = { pool, init, createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, countProvidersByCity, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions, getPendingApplications, getApplicationDetails, approveApplication, getProviderProfile, getProviderSessions, getProviderStats, updateProviderProfile, getProviderRequests, createSessionFromRequest, listProviders, getProviderIdForUser, insertMessage, getMessagesForUser, markMessagesRead };
