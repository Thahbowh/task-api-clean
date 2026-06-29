const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const { getAllUsers, getAllTasks, updateUserRole }
  = require('../controllers/admin.controller');

router.use(authenticate);
router.use(isAdmin);

router.get('/users', getAllUsers);
router.get('/tasks', getAllTasks);
router.put('/users/:id/role', updateUserRole);

module.exports = router;