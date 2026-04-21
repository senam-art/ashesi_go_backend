const express = require('express');
const router = express.Router();
const passengerController = require('../controllers/passengerController');

router.get('/balance', passengerController.getBalance);
router.post('/board', passengerController.processBoarding);
router.post('/resolve-tag', passengerController.resolveTag);
router.get('/journey-stops/:actJouId', passengerController.getJourneyStops);
router.get('/stops-for-vehicle/:vehicleId', passengerController.getStopsForVehicle);
router.get('/daily-upcoming-trips', passengerController.getDailyUpcomingTrips);

module.exports = router;
