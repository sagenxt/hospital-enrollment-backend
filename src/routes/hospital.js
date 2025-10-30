const express = require('express');
const multer = require('multer');
const hospitalController = require('../controllers/hospitalController');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Public routes
router.post('/', upload.any(), hospitalController.createHospital);
router.post('/login', express.json(), authController.login);

// Protected routes
router.use(authMiddleware);
router.get('/', hospitalController.getHospitalsByStatus);
router.put('/:id/status', hospitalController.updateHospitalStatus);
router.get('/:id/documents', hospitalController.getDocumentsByHospitalId);

module.exports = router;
