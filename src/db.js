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
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      ages JSONB,
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
  const createRequests = `
    CREATE TABLE IF NOT EXISTS childcare_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
      location TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createSessions = `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_date DATE,
      start_time TIME,
      end_time TIME,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  try{
    await pool.query(createUsers);
    await pool.query(createProviderApps);
    await pool.query(createChildren);
    await pool.query(createWaitlist);
    await pool.query(createRequests);
    await pool.query(createSessions);
    
    // Add name column to children if it doesn't exist
    try {
      await pool.query(`ALTER TABLE children ADD COLUMN name TEXT;`);
    } catch(e) {
      // Column might already exist, ignore
    }
    
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
  const sql = 'INSERT INTO provider_applications(user_id,experience,availability,age_groups,certifications) VALUES($1,$2,$3,$4,$5)';
  const params = [user_id, experience || null, availability ? JSON.stringify(availability) : null, age_groups ? JSON.stringify(age_groups) : null, certifications || null];
  return pool.query(sql, params);
}

async function insertChildProfile({ user_id, name, ages, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = 'INSERT INTO children(user_id,name,ages,frequency,preferred_schedule,special_needs) VALUES($1,$2,$3,$4,$5,$6) RETURNING id';
  const params = [user_id, name || null, ages ? JSON.stringify(ages) : null, frequency || null, preferred_schedule || null, special_needs || null];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

async function findUserByEmail(email){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, password_hash, type, city, province FROM users WHERE email=$1';
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function countProvidersByCity(city){
  if(!pool) return 0;
  const sql = "SELECT COUNT(*) AS c FROM users WHERE type='provider' AND LOWER(city) = LOWER($1)";
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
  const sql = 'SELECT id, name, ages, frequency, preferred_schedule, special_needs, created_at FROM children WHERE user_id=$1 ORDER BY name ASC, created_at DESC';
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getOrCreateChild(user_id, childName){
  if(!pool) return null;
  
  // If a name is provided, try to find existing child with that name
  if(childName && childName.trim()){
    const findSql = 'SELECT id FROM children WHERE user_id=$1 AND name=$2 LIMIT 1';
    const findResult = await pool.query(findSql, [user_id, childName.trim()]);
    if(findResult.rows.length > 0){
      return findResult.rows[0].id;
    }
    
    // Create new child with this name
    const createSql = 'INSERT INTO children(user_id, name, ages, frequency, preferred_schedule, special_needs) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
    const createResult = await pool.query(createSql, [user_id, childName.trim(), null, null, null, null]);
    return createResult.rows[0]?.id;
  }
  
  // If no name provided, create a generic child
  const createSql = 'INSERT INTO children(user_id, name, ages, frequency, preferred_schedule, special_needs) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
  const createResult = await pool.query(createSql, [user_id, null, null, null, null, null]);
  return createResult.rows[0]?.id;
}

async function getParentProfile(user_id){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, city, province, created_at FROM users WHERE id=$1 AND type=$2';
  const result = await pool.query(sql, [user_id, 'parent']);
  return result.rows[0] || null;
}

async function insertChildcareRequest({ user_id, child_id, location, notes }){
  if(!pool) return;
  const sql = 'INSERT INTO childcare_requests(user_id, child_id, location, notes) VALUES($1, $2, $3, $4) RETURNING id';
  const result = await pool.query(sql, [user_id, child_id || null, location, notes || null]);
  return result.rows[0]?.id;
}

async function getParentRequests(user_id){
  if(!pool) return [];
  const sql = 'SELECT id, location, status, notes, created_at FROM childcare_requests WHERE user_id=$1 ORDER BY created_at DESC';
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getParentSessions(user_id){
  if(!pool) return [];
  const sql = `
    SELECT s.id, s.session_date, s.start_time, s.end_time, s.status, 
           u.name as provider_name, u.city as provider_city
    FROM sessions s
    LEFT JOIN users u ON s.provider_id = u.id
    WHERE s.user_id=$1 AND s.session_date >= CURRENT_DATE
    ORDER BY s.session_date ASC, s.start_time ASC
  `;
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

module.exports = { pool, init, createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, countProvidersByCity, insertWaitlistEntry, getParentChildren, getParentProfile, getOrCreateChild, insertChildcareRequest, getParentRequests, getParentSessions };
