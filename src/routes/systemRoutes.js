const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const journeyService = require('../services/journeyService');

router.post('/generate-weekly', systemController.createRecurringSchedule);
router.post('/run-weekly', systemController.runWeeklyNow);
router.get('/fetch-all-trips', journeyService.getUpcomingTrips);
router.post('/webhooks/bus-arrival', systemController.busArrivalNotification);
router.get('/journeys/trip-details/:id', journeyService.getTripDetails);

module.exports = router;
