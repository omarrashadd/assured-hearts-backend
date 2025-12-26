const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if(!DATABASE_URL){
  console.warn('[DB] DATABASE_URL not set. Database features disabled.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function init(){
  if(!pool) return;
  const createParents = `
    CREATE TABLE IF NOT EXISTS parents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      children JSONB,
      city TEXT,
      province TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  const createProviders = `
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      experience TEXT,
      city TEXT,
      province TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`;
  try{
    await pool.query(createParents);
    await pool.query(createProviders);
    console.log('[DB] Tables ensured');
  }catch(err){
    console.error('[DB] Init failed', err);
  }
}

async function insertParent({ name, email, phone, children, meta }){
  if(!pool) return;
  const city = meta?.city || null;
  const province = meta?.province || null;
  const sql = 'INSERT INTO parents(name,email,phone,children,city,province) VALUES($1,$2,$3,$4,$5,$6)';
  const params = [name, email, phone, children ? JSON.stringify(children) : null, city, province];
  return pool.query(sql, params);
}

async function insertProvider({ name, email, phone, experience, meta }){
  if(!pool) return;
  const city = meta?.city || null;
  const province = meta?.province || null;
  const sql = 'INSERT INTO providers(name,email,phone,experience,city,province) VALUES($1,$2,$3,$4,$5,$6)';
  const params = [name, email, phone, experience || null, city, province];
  return pool.query(sql, params);
}

module.exports = { pool, init, insertParent, insertProvider };
