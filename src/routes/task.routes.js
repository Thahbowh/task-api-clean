
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getTasks, getTask, createTask, updateTask, deleteTask }
  = require('../controllers/task.controller');

router.use(authenticate);

router.get('/', getTasks);
router.get('/:id', getTask);
router.post('/', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

module.exports = router;