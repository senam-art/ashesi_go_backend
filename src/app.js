const express = require('express');
const cors = require('cors'); 
const authRoutes = require('./routes/authRoutes');
const driverRoutes = require('./routes/driverRoutes');
const passengerRoutes = require('./routes/passengerRoutes'); 
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes); 
app.use('/api/driver', driverRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/payment',paymentRoutes);

// Simple Health Check
app.get('/health', (req, res) => res.send('System Healthy 🚀'));

module.exports = app;

//live tracking of bus info to other drivers- 
//available seats