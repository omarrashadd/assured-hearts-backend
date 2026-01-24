require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const formsRouter = require('./routes/forms');
const searchRouter = require('./routes/search');
const paymentsRouter = require('./routes/payments');
const pricingRouter = require('./routes/pricing');
const { init, pool } = require('./db');

const app = express();

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || '*';
const LOG_LEVEL = process.env.LOG_LEVEL || 'dev';

app.use(helmet());
app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(LOG_LEVEL));
// Ensure DB tables are created if a DATABASE_URL is present
init();

app.use('/health', healthRouter);
app.use('/forms', formsRouter);
app.use('/search', searchRouter);
app.use('/payments', paymentsRouter);
app.use('/pricing', pricingRouter);

// Root endpoint for quick sanity checks
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Assured Hearts API' });
});

// Simple stats endpoint (duplicate location to avoid router export issues)
app.get('/forms/stats', async (req, res) => {
  try{
    if(!pool) return res.json({ parents: null, providers: null });
    const p = await pool.query('SELECT COUNT(*) AS c FROM users WHERE type=\'parent\'');
    const prov = await pool.query('SELECT COUNT(*) AS c FROM users WHERE type=\'provider\'');
    return res.json({ parents: Number(p.rows[0].c), providers: Number(prov.rows[0].c) });
  }catch(err){
    console.error('Stats error (server):', err);
    return res.status(500).json({ error: 'Stats failed' });
  }
});

// Recent submissions preview
app.get('/forms/recent', async (req, res) => {
  try{
    if(!pool) return res.json({ parents: [], providers: [] });
    const parents = await pool.query('SELECT id, name, email, phone, city, province, created_at FROM users WHERE type=\'parent\' ORDER BY created_at DESC LIMIT 5');
    const providers = await pool.query('SELECT u.id, u.name, u.email, u.phone, u.city, u.province, p.age_groups, u.created_at FROM users u LEFT JOIN provider_applications p ON u.id=p.user_id WHERE u.type=\'provider\' ORDER BY u.created_at DESC LIMIT 5');
    return res.json({ parents: parents.rows, providers: providers.rows });
  }catch(err){
    console.error('Recent error:', err);
    return res.status(500).json({ error: 'Recent failed' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
