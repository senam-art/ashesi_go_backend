const express = require('express');
const cors = require('cors'); // Run 'npm install cors' to allow Flutter to connect
const driverRoutes = require('./routes/driverRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/driver', driverRoutes);
app.use('/api/passenger', passengerRoutes);

// Simple Health Check
app.get('/health', (req, res) => res.send('System Healthy 🚀'));

module.exports = app;