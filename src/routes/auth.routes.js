const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/auth.controller');

router.post('/register', (req, res) => {
  res.json({ message: "Register works" });
});
catch (err) {
  console.error("LOGIN ERROR:", err);
  return res.status(500).json({ error: err.message });
});
module.exports = router;