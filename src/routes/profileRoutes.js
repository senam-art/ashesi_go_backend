const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

router.get('/username/available', profileController.checkUsernameAvailable);
router.patch('/username', profileController.updateUsername);
router.get('/lookup/:username', profileController.lookupByUsername);
router.get('/:userId', profileController.getProfile);

module.exports = router;
