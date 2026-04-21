const express = require('express');
const cors = require('cors');

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

app.use('/api/auth', authRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/scheduler', systemRoutes);

app.get('/health', (req, res) => res.send('System Healthy 🚀'));

module.exports = app;
