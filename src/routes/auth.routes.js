const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/auth.controller');

router.post('/register', (req, res) => {
  res.json({ message: "Register works" });
});
router.post('/login', login);

module.exports = router;