const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if(!DATABASE_URL){
  console.warn('[DB] DATABASE_URL not set. Database features disabled.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function init(){
  if(!pool) return;
  
  try {
    // Migration: Add missing columns to providers table if they don't exist
    const migrations = [
      "ALTER TABLE providers ADD COLUMN IF NOT EXISTS user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE",
      "ALTER TABLE providers ADD COLUMN IF NOT EXISTS certifications TEXT",
      "ALTER TABLE providers ADD COLUMN IF NOT EXISTS age_groups JSONB",
      "ALTER TABLE providers ADD COLUMN IF NOT EXISTS availability JSONB",
      "ALTER TABLE providers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()",
      "CREATE INDEX IF NOT EXISTS idx_providers_user_id ON providers(user_id)"
    ];
    
    for (const migration of migrations) {
      await pool.query(migration);
    }
    console.log('[DB] Migrations applied successfully');
  } catch(err) {
    console.error('[DB] Migration failed:', err.message);
  }
  
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
  try{
    await pool.query(createUsers);
    await pool.query(createProviderApps);
    await pool.query(createChildren);
    await pool.query(createWaitlist);
    await pool.query(createProviders);
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
  const sql = 'SELECT id, ages, frequency, preferred_schedule, special_needs, created_at FROM children WHERE user_id=$1 ORDER BY created_at DESC';
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getParentProfile(user_id){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, city, province, created_at FROM users WHERE id=$1 AND type=\'parent\'';
  const result = await pool.query(sql, [user_id]);
  return result.rows[0] || null;
}

async function updateChild({ child_id, name, ages, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = 'UPDATE children SET ages=$1, frequency=$2, preferred_schedule=$3, special_needs=$4 WHERE id=$5';
  await pool.query(sql, [ages ? JSON.stringify(ages) : null, frequency, preferred_schedule, special_needs, child_id]);
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
  console.log('[DB] Age groups type:', typeof app.age_groups, app.age_groups);
  console.log('[DB] Availability type:', typeof app.availability, app.availability);
  
  // Ensure JSONB fields are properly formatted (convert to JSON string if they're objects)
  const ageGroupsJson = app.age_groups ? (typeof app.age_groups === 'string' ? app.age_groups : JSON.stringify(app.age_groups)) : null;
  const availabilityJson = app.availability ? (typeof app.availability === 'string' ? app.availability : JSON.stringify(app.availability)) : null;
  
  // Insert into providers table
  const insertSql = `
    INSERT INTO providers (user_id, name, email, phone, city, province, experience, certifications, age_groups, availability)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      city = EXCLUDED.city,
      province = EXCLUDED.province,
      experience = EXCLUDED.experience,
      certifications = EXCLUDED.certifications,
      age_groups = EXCLUDED.age_groups,
      availability = EXCLUDED.availability,
      approved_at = NOW()
    RETURNING id
  `;
  const result = await pool.query(insertSql, [
    app.user_id, app.name, app.email, app.phone, app.city, app.province,
    app.experience, app.certifications, ageGroupsJson, availabilityJson
  ]);
  
  const providerId = result.rows[0]?.id;
  console.log('[DB] Provider created/updated:', providerId);
  return providerId;
}

module.exports = { pool, init, createParentUser, createProviderUser, insertProviderApplication, insertChildProfile, findUserByEmail, countProvidersByCity, insertWaitlistEntry, getParentChildren, getParentProfile, updateChild, getPendingApplications, getApplicationDetails, approveApplication };
