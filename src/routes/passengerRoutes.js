const express = require('express');
const router = express.Router();
const passengerController = require('../controllers/passengerController');

// This handles the NFC Scan we discussed
router.post('/scan-bus', passengerController.recordStudentSelfScan);

// This lets the student see their previous trips
router.get('/history/:studentId', passengerController.getStudentHistory);

module.exports = router;