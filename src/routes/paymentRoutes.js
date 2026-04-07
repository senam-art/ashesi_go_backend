const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/initialize', paymentController.initializePayment);
router.get('/balance/:userId', paymentController.getBalance);
router.get('/transactions/:userId', paymentController.getTransactions);
router.get('/verify/:reference', paymentController.verifyPayment);




module.exports = router;
