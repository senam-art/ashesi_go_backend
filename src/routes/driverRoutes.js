const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

router.get('/routes', driverController.getRoutes);
router.patch('/start-trip', driverController.startJourney);
router.post('/end-trip', driverController.endTrip);
router.get('/active-journeys', driverController.getActiveJourneys);
router.post('/route-data', driverController.getRouteData);
router.post('/journey-data', driverController.getJourneyData);
router.get('/schedule/today', driverController.getTodaySchedule);
router.get('/my-ongoing-journey', driverController.getMyOngoingJourney);
router.post('/journey/record-stop', driverController.recordStopVisit);
router.post('/journey/record-action', driverController.recordStopAction);
router.post('/broadcast-alert', driverController.broadcastAlert);
router.get('/journey/status/:actJouId', driverController.getJourneyStatus);
router.get('/history/:driverId', driverController.getDriverHistory);
router.get('/profile/:driverId', driverController.getDriverProfile);

module.exports = router;
