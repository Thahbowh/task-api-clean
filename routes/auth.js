const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

// ─── REGISTER ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });

    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0)
      return res.status(409).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.execute(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'customer')",
      [name, email, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── LOGIN ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });

    const userRow = rows[0];
    const match   = await bcrypt.compare(password, userRow.password);
    if (!match)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: userRow.id, name: userRow.name, role: userRow.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Return full user object so frontend can save role, email, etc.
    res.json({
      token,
      user: {
        id:        userRow.id,
        name:      userRow.name,
        email:     userRow.email,
        role:      userRow.role,
        createdAt: userRow.created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── LOGOUT ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

module.exports = router;