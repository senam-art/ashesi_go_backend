const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const journeyService = require('../services/journeyService')

router.post('/generate-weekly', systemController.createRecurringSchedule);
router.get('/fetch-all-trips', journeyService.getUpcomingTrips);
router.post('/webhooks/bus-arrival', systemController.busArrivalNotification);


module.exports = router;

