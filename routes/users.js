// routes/users.js
// Fixed to handle both old users (name column) and new users (first_name + last_name)
// Uses COALESCE to merge both into a single "name" field for the admin panel

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const bcrypt  = require('bcryptjs');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

// ── Helper: build display name from whichever columns exist ──────────────────
// SQL: prefers first_name+last_name, falls back to name column
const NAME_SELECT = `
  COALESCE(
    NULLIF(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))), ''),
    name
  ) AS name
`;

// ── GET ALL USERS (admin only) ───────────────────────────────────────────────
router.get('/', verifyToken, checkRole(['admin']), (req, res) => {
  const sql = `
    SELECT
      id,
      ${NAME_SELECT},
      first_name,
      last_name,
      email,
      phone,
      role,
      created_at
    FROM users
    ORDER BY created_at DESC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch users', error: err });
    res.json(results);
  });
});

// ── GET SINGLE USER (admin only) ─────────────────────────────────────────────
router.get('/:id', verifyToken, checkRole(['admin']), (req, res) => {
  const sql = `
    SELECT
      id,
      ${NAME_SELECT},
      first_name,
      last_name,
      email,
      phone,
      role,
      created_at
    FROM users
    WHERE id = ?
  `;
  db.query(sql, [req.params.id], (err, results) => {
    if (err)             return res.status(500).json({ message: 'Failed to fetch user' });
    if (!results.length) return res.status(404).json({ message: 'User not found' });
    res.json(results[0]);
  });
});

// ── UPDATE OWN PROFILE (customer) ────────────────────────────────────────────
router.put('/update-profile', verifyToken, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Name is required.' });
  }

  const first = name.trim().split(' ')[0];
  const last  = name.trim().split(' ').slice(1).join(' ');
  const full  = name.trim();

  const sql = `
    UPDATE users
    SET name=?, first_name=?, last_name=?
    WHERE id=?
  `;
  db.query(sql, [full, first, last, req.user.id], (err) => {
    if (err) return res.status(500).json({ message: 'Update failed', error: err });
    res.json({ success: true, name: full });
  });
});

// ── UPDATE USER (admin only) ──────────────────────────────────────────────────
router.put('/:id', verifyToken, checkRole(['admin']), (req, res) => {
  const { name, firstName, lastName, email, role, password } = req.body;

  // Support both old (name) and new (firstName+lastName) payloads
  const first = firstName || (name ? name.split(' ')[0] : '');
  const last  = lastName  || (name ? name.split(' ').slice(1).join(' ') : '');
  const full  = name || `${first} ${last}`.trim();

  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    const sql = `
      UPDATE users
      SET name=?, first_name=?, last_name=?, email=?, role=?, password=?
      WHERE id=?
    `;
    db.query(sql, [full, first, last, email, role, hashed, req.params.id], (err) => {
      if (err) return res.status(500).json({ message: 'Update failed', error: err });
      res.json({ message: 'User updated successfully.' });
    });
  } else {
    const sql = `
      UPDATE users
      SET name=?, first_name=?, last_name=?, email=?, role=?
      WHERE id=?
    `;
    db.query(sql, [full, first, last, email, role, req.params.id], (err) => {
      if (err) return res.status(500).json({ message: 'Update failed', error: err });
      res.json({ message: 'User updated successfully.' });
    });
  }
});

// ── DELETE USER (admin only) ──────────────────────────────────────────────────
router.delete('/:id', verifyToken, checkRole(['admin']), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: "You can't delete your own account." });
  }
  db.query('DELETE FROM users WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Delete failed', error: err });
    res.json({ message: 'User deleted successfully.' });
  });
});

// ── CREATE USER (admin only) ──────────────────────────────────────────────────
router.post('/', verifyToken, checkRole(['admin']), (req, res) => {
  const { name, firstName, lastName, email, password, role } = req.body;

  // Accept both old (name) and new (firstName+lastName) payloads
  const first = firstName || (name ? name.split(' ')[0] : '');
  const last  = lastName  || (name ? name.split(' ').slice(1).join(' ') : '');
  const full  = name || `${first} ${last}`.trim();

  if (!full || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }

  db.query('SELECT id FROM users WHERE email = ?', [email], (err, existing) => {
    if (err)              return res.status(500).json({ message: 'Server error.' });
    if (existing.length)  return res.status(409).json({ message: 'Email already in use.' });

    const hashed = bcrypt.hashSync(password, 10);
    const sql = `
      INSERT INTO users (name, first_name, last_name, email, password, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [full, first, last, email, hashed, role || 'customer'], (err2) => {
      if (err2) return res.status(500).json({ message: 'Failed to create user', error: err2 });
      res.status(201).json({ message: 'User created successfully.' });
    });
  });
});

module.exports = router;