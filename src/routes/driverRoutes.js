const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

router.get('/routes', driverController.getRoutes);
router.post('/start-trip', driverController.startJourney);
router.post('/end-trip', driverController.endTrip);
router.get('/active-journeys', driverController.getActiveJourneys);
router.post('/route-data', driverController.getRouteData);
router.post('/journey-data', driverController.getJourneyData);
router.get('/schedule/today', driverController.getTodaySchedule);
router.post('/journey/record-stop', driverController.recordStopVisit);
router.post('/journey/record-action', driverController.recordStopAction);
router.get('/journey/status/:actJouId', driverController.getJourneyStatus);

module.exports = router;
