const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');

//This matches http://YOUR_IP:3000/api/driver/dashboard
router.get('/routes', driverController.getRoutes)
router.post('/start-trip', driverController.startJourney)
router.get('/active-journeys', driverController.getActiveJourneys)
//sends an active journey id to get journey data
router.post('/route-data', driverController.getRouteData)
router.post('/journey-data', driverController.getJourneyData)
router.get('/schedule/today', driverController.getTodaySchedule)
router.post('/journey/record-stop', driverController.recordStopVisit)
router.get('/journey/status',driverController.getJourneyStatus)




module.exports = router;
