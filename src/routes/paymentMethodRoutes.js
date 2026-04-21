const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentMethodController');

// Mounted at /api/payment-methods
router.get('/:userId', ctrl.listMethods);
router.post('/', ctrl.createMethod);
router.patch('/:id', ctrl.updateMethod);
router.delete('/:id', ctrl.deleteMethod);

module.exports = router;
