require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const healthRouter = require('./routes/health');
const formsRouter = require('./routes/forms');

const app = express();

const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.ORIGIN || '*';
const LOG_LEVEL = process.env.LOG_LEVEL || 'dev';

app.use(helmet());
app.use(cors({ origin: ORIGIN === '*' ? true : ORIGIN.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(LOG_LEVEL));

app.use('/health', healthRouter);
app.use('/forms', formsRouter);

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
