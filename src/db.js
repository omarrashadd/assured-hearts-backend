const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if(!DATABASE_URL){
  console.warn('[DB] DATABASE_URL not set. Database features disabled.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function init(){
  if(!pool) {
    console.warn('[DB] No pool available, skipping init');
    return;
  }
  
  console.log('[DB] Starting database initialization...');
  
  // Drop all tables and start fresh (data loss is acceptable for testing)
  try {
    console.log('[DB] Dropping all existing tables...');
    await pool.query(`DROP TABLE IF EXISTS sessions CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS childcare_requests CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS children CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS providers CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS providers_applications CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS parents CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS waitlist CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS users CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS provider_applications CASCADE;`);
    console.log('[DB] Successfully dropped all existing tables');
  } catch(e) {
    console.error('[DB] Error dropping tables:', e.message);
  }
  
  const createParentsTable = `
    CREATE TABLE parents (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      province TEXT,
      password_hash TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
    
  const createProvidersApplicationsTable = `
    CREATE TABLE providers_applications (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      province TEXT,
      password_hash TEXT,
      experience TEXT,
      experience_details TEXT,
      has_cpr BOOLEAN DEFAULT false,
      islamic_values BOOLEAN DEFAULT false,
      age_groups JSONB,
      availability JSONB,
      references TEXT,
      status TEXT DEFAULT 'pending',
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      reviewed_at TIMESTAMP WITH TIME ZONE,
      reviewed_by INTEGER
    );`;
    
  const createProvidersTable = `
    CREATE TABLE providers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT,
      province TEXT,
      password_hash TEXT,
      experience TEXT,
      experience_details TEXT,
      has_cpr BOOLEAN DEFAULT false,
      islamic_values BOOLEAN DEFAULT false,
      age_groups JSONB,
      availability JSONB,
      references TEXT,
      rating DECIMAL(3,2),
      approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;

  const createChildren = `
    CREATE TABLE children (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      name TEXT,
      ages JSONB,
      frequency TEXT,
      preferred_schedule TEXT,
      special_needs TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
    
  const createWaitlist = `
    CREATE TABLE waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      city TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
    
  const createRequests = `
    CREATE TABLE childcare_requests (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
      location TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
    
  const createSessions = `
    CREATE TABLE sessions (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
      session_date DATE,
      start_time TIME,
      end_time TIME,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
    
  try{
    console.log('[DB] Creating parents table...');
    await pool.query(createParentsTable);
    console.log('[DB] Creating providers_applications table...');
    await pool.query(createProvidersApplicationsTable);
    console.log('[DB] Creating providers table...');
    await pool.query(createProvidersTable);
    console.log('[DB] Creating children table...');
    await pool.query(createChildren);
    console.log('[DB] Creating waitlist table...');
    await pool.query(createWaitlist);
    console.log('[DB] Creating childcare_requests table...');
    await pool.query(createRequests);
    console.log('[DB] Creating sessions table...');
    await pool.query(createSessions);
    
    console.log('[DB] ✓ All tables recreated successfully');
  }catch(err){
    console.error('[DB] ✗ Init failed:', err.message);
    console.error('[DB] Error details:', err);
  }
}

// Hash password helper
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Create parent account directly (for immediate access)
async function createParentUser({ name, email, phone, password, city, province }){
  if(!pool) return;
  const password_hash = password ? await hashPassword(password) : null;
  const sql = 'INSERT INTO parents(name, email, phone, password_hash, city, province) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
  const params = [name, email, phone, password_hash, city, province];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

// Create provider application (pending approval)
async function createProviderApplication({ name, email, phone, password, experience, experience_details, has_cpr, islamic_values, age_groups, availability, references, city, province }){
  if(!pool) return;
  const password_hash = password ? await hashPassword(password) : null;
  const sql = `INSERT INTO providers_applications(name, email, phone, password_hash, experience, experience_details, has_cpr, islamic_values, age_groups, availability, references, city, province, status) 
               VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending') RETURNING id`;
  const params = [name, email, phone, password_hash, experience || null, experience_details || null, has_cpr || false, islamic_values || false, age_groups ? JSON.stringify(age_groups) : null, availability ? JSON.stringify(availability) : null, references || null, city, province];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

// Approve a provider application and move to providers table
async function approveProviderApplication(application_id){
  if(!pool) return;
  try {
    // Get the application details
    const appSql = 'SELECT * FROM providers_applications WHERE id=$1';
    const appResult = await pool.query(appSql, [application_id]);
    const app = appResult.rows[0];
    
    if(!app) throw new Error('Application not found');
    
    // Insert into providers table
    const providerSql = `INSERT INTO providers(name, email, phone, password_hash, experience, experience_details, has_cpr, islamic_values, age_groups, availability, references, city, province) 
                         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`;
    const providerParams = [app.name, app.email, app.phone, app.password_hash, app.experience, app.experience_details, app.has_cpr, app.islamic_values, app.age_groups, app.availability, app.references, app.city, app.province];
    const providerResult = await pool.query(providerSql, providerParams);
    const provider_id = providerResult.rows[0]?.id;
    
    // Update application status to approved
    const updateSql = 'UPDATE providers_applications SET status=$1, reviewed_at=$2 WHERE id=$3';
    await pool.query(updateSql, ['approved', new Date(), application_id]);
    
    return provider_id;
  } catch(err) {
    console.error('[DB] Approve provider application failed:', err);
    throw err;
  }
}

// Get pending provider applications
async function getPendingProviderApplications(){
  if(!pool) return [];
  const sql = 'SELECT id, name, email, phone, experience, has_cpr, islamic_values, applied_at FROM providers_applications WHERE status=$1 ORDER BY applied_at ASC';
  const result = await pool.query(sql, ['pending']);
  return result.rows || [];
}

// Get provider application details
async function getProviderApplicationDetails(application_id){
  if(!pool) return null;
  const sql = 'SELECT * FROM providers_applications WHERE id=$1';
  const result = await pool.query(sql, [application_id]);
  return result.rows[0] || null;
}

async function insertChildProfile({ user_id, name, ages, frequency, preferred_schedule, special_needs }){
  if(!pool) return;
  const sql = 'INSERT INTO children(parent_id, name, ages, frequency, preferred_schedule, special_needs) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
  const params = [user_id, name || null, ages ? JSON.stringify(ages) : null, frequency || null, preferred_schedule || null, special_needs || null];
  const result = await pool.query(sql, params);
  return result.rows[0]?.id;
}

async function findParentByEmail(email){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, password_hash, city, province FROM parents WHERE email=$1';
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function findProviderApplicationByEmail(email){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, password_hash, status FROM providers_applications WHERE email=$1';
  const result = await pool.query(sql, [email]);
  return result.rows[0] || null;
}

async function findProviderByEmail(email){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, password_hash, city, province FROM providers WHERE email=$1';
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
  const sql = 'SELECT id, name, ages, frequency, preferred_schedule, special_needs, created_at FROM children WHERE parent_id=$1 ORDER BY name ASC, created_at DESC';
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
}

async function getOrCreateChild(user_id, childName){
  if(!pool) return null;
  
  // If a name is provided, try to find existing child with that name
  if(childName && childName.trim()){
    const findSql = 'SELECT id FROM children WHERE parent_id=$1 AND name=$2 LIMIT 1';
    const findResult = await pool.query(findSql, [user_id, childName.trim()]);
    if(findResult.rows.length > 0){
      return findResult.rows[0].id;
    }
    
    // Create new child with this name
    const createSql = 'INSERT INTO children(parent_id, name, ages, frequency, preferred_schedule, special_needs) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
    const createResult = await pool.query(createSql, [user_id, childName.trim(), null, null, null, null]);
    return createResult.rows[0]?.id;
  }
  
  // If no name provided, create a generic child
  const createSql = 'INSERT INTO children(parent_id, name, ages, frequency, preferred_schedule, special_needs) VALUES($1, $2, $3, $4, $5, $6) RETURNING id';
  const createResult = await pool.query(createSql, [user_id, null, null, null, null, null]);
  return createResult.rows[0]?.id;
}

async function getParentProfile(user_id){
  if(!pool) return null;
  const sql = 'SELECT id, name, email, phone, city, province, created_at FROM parents WHERE id=$1';
  const result = await pool.query(sql, [user_id]);
  return result.rows[0] || null;
}

async function insertChildcareRequest({ user_id, child_id, location, notes }){
  if(!pool) return;
  const sql = 'INSERT INTO childcare_requests(parent_id, child_id, location, notes) VALUES($1, $2, $3, $4) RETURNING id';
  const result = await pool.query(sql, [user_id, child_id || null, location, notes || null]);
  return result.rows[0]?.id;
}

async function getParentRequests(user_id){
  if(!pool) return [];
  const sql = 'SELECT id, location, status, notes, created_at FROM childcare_requests WHERE parent_id=$1 ORDER BY created_at DESC';
  const result = await pool.query(sql, [user_id]);
  return result.rows || [];
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

module.exports = { 
  pool, 
  init, 
  createParentUser, 
  createProviderApplication,
  approveProviderApplication,
  getPendingProviderApplications,
  getProviderApplicationDetails,
  insertChildProfile, 
  findParentByEmail,
  findProviderApplicationByEmail,
  findProviderByEmail,
  countProvidersByCity, 
  insertWaitlistEntry, 
  getParentChildren, 
  getParentProfile, 
  getOrCreateChild, 
  insertChildcareRequest, 
  getParentRequests, 
  getParentSessions 
};
