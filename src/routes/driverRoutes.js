const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

//This matches http://YOUR_IP:3000/api/driver/dashboard
router.get('/dashboard', driverController.getDashboard);
router.post('/start-trip', driverController.startJourney);

module.exports = router;
