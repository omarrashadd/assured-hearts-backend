require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const formsRouter = require('./routes/forms');
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

// Root endpoint for quick sanity checks
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Assured Hearts API' });
});

// Simple stats endpoint (duplicate location to avoid router export issues)
app.get('/forms/stats', async (req, res) => {
  try{
    if(!pool) return res.json({ parents: null, providers: null });
    const p = await pool.query('SELECT COUNT(*) AS c FROM parents');
    const r = await pool.query('SELECT COUNT(*) AS c FROM providers');
    return res.json({ parents: Number(p.rows[0].c), providers: Number(r.rows[0].c) });
  }catch(err){
    console.error('Stats error (server):', err);
    return res.status(500).json({ error: 'Stats failed' });
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
