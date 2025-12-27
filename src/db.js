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
  try{
    await pool.query(createUsers);
    await pool.query(createProviderApps);
    await pool.query(createChildren);
    await pool.query(createWaitlist);
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

async function insertChildProfile({ user_id, ages, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = 'INSERT INTO children(user_id,ages,frequency,preferred_schedule,special_needs) VALUES($1,$2,$3,$4,$5) RETURNING id';
  const params = [user_id, ages ? JSON.stringify(ages) : null, frequency || null, preferred_schedule || null, special_needs || null];
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

module.exports = { pool, init, createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, countProvidersByCity, insertWaitlistEntry };
