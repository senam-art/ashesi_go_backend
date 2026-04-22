const express = require('express');
const cors = require('cors');

const { verboseHttpLogger } = require('./middleware/verboseHttpLogger');
const { ts } = require('./utils/verboseLog');

const authRoutes = require('./routes/authRoutes');
const driverRoutes = require('./routes/driverRoutes');
const passengerRoutes = require('./routes/passengerRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const paymentMethodRoutes = require('./routes/paymentMethodRoutes');
const profileRoutes = require('./routes/profileRoutes');
const systemRoutes = require('./routes/systemRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(verboseHttpLogger);

app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/scheduler', systemRoutes);

app.get('/health', (req, res) => res.send('System Healthy 🚀'));

// Unmatched routes (still logged by verboseHttpLogger on the way out)
app.use((req, res) => {
  console.log(`[${ts()}] [404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

app.use((err, req, res, _next) => {
  console.error(`[${ts()}] [EXPRESS_ERROR]`, err.stack || err.message);
  if (res.headersSent) {
    return _next(err);
  }
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  return res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

module.exports = app;
