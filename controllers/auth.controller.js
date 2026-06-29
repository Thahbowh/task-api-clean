// controllers/auth.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// All authentication logic for Thah_Bowh's POS System.
// Uses: bcryptjs · jsonwebtoken · db (callback MySQL) · emailService
//
// Endpoints handled:
//   POST /auth/register          — create customer account
//   POST /auth/login             — authenticate, return JWT
//   POST /auth/forgot-password   — generate & email OTP
//   POST /auth/verify-otp        — validate 6-digit code → return reset token
//   POST /auth/reset-password    — set new password using reset token
//   POST /auth/refresh           — refresh access token
//   POST /auth/logout            — clear refresh token
// ─────────────────────────────────────────────────────────────────────────────

const db      = require('../db');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');

const {
  generateOTP,
  verifyOTP,
  invalidateOTP,
  sendOTPEmail,
  sendPasswordChangedEmail,
} = require('../emailService');

// ── JWT helpers ───────────────────────────────────────────────────────────────

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function signResetToken(email) {
  // Short-lived JWT used only to authorise the reset-password step
  return jwt.sign(
    { sub: email.toLowerCase(), purpose: 'password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function verifyResetToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose !== 'password_reset') return null;
    return decoded.sub; // email
  } catch {
    return null;
  }
}

// ── Password strength check (mirrors frontend rules) ─────────────────────────

function isStrongPassword(pw) {
  return (
    pw.length >= 8 &&
    /[0-9]/.test(pw) &&
    /[^a-zA-Z0-9]/.test(pw)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────────────────────────────────────
exports.register = (req, res) => {
  const { firstName, lastName, email, phone, password,
          dob, gender, emergencyName, emergencyPhone } = req.body;

  // ── Required fields ───────────────────────────────────────────────────────
  if (!firstName || !lastName || !email || !phone || !password) {
    return res.status(400).json({ message: 'All required fields must be provided.' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters and include a number and a symbol.'
    });
  }

  const normalEmail = email.trim().toLowerCase();

  // ── Check for duplicate email ─────────────────────────────────────────────
  db.query('SELECT id FROM users WHERE email = ?', [normalEmail], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

    if (results.length > 0) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const sql = `
      INSERT INTO users
        (first_name, last_name, email, phone, password, role,
         dob, gender, emergency_name, emergency_phone)
      VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?)
    `;
    // ↑ role is ALWAYS forced to 'customer' — never taken from the request body

    const values = [
      firstName.trim(),
      lastName.trim(),
      normalEmail,
      phone.trim(),
      hashedPassword,
      dob             || null,
      gender          || null,
      emergencyName   || null,
      emergencyPhone  || null,
    ];

    db.query(sql, values, (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

      res.status(201).json({
        message: 'Account created successfully.',
        user: {
          id:         result.insertId,
          firstName:  firstName.trim(),
          email:      normalEmail,
          role:       'customer',
        }
      });
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
exports.login = (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const sql = 'SELECT * FROM users WHERE email = ?';

  db.query(sql, [email.trim().toLowerCase()], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

    if (results.length === 0) {
      return res.status(404).json({ message: 'No account found with that email.' });
    }

    const user    = results[0];
    const isMatch = bcrypt.compareSync(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password.' });
    }

    const token = signAccessToken({ id: user.id, role: user.role });

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id:        user.id,
        firstName: user.first_name || user.name,
        email:     user.email,
        role:      user.role,
      }
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD  →  generate + email OTP
// ─────────────────────────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'Please provide a valid email address.' });
  }

  // ── Look up the user ──────────────────────────────────────────────────────
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

    // ── Always generate OTP regardless of whether user exists ────────────────
    // This prevents timing attacks that reveal whether an email is registered.
    const otp = generateOTP(email);

    if (results.length > 0) {
      const user      = results[0];
      const firstName = user.first_name || user.name || 'there';
      const sent      = await sendOTPEmail(email, otp, firstName);

      if (!sent) {
        console.error(`[auth] OTP email failed for ${email}`);
        // Don't expose this failure to the client
      }
    }
    // If user doesn't exist: OTP was generated but email is never sent.
    // Client gets the same response either way → no enumeration.

    // ── Always the same response ──────────────────────────────────────────
    res.json({
      message: "If this email is registered, a reset code has been sent."
    });
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY OTP  →  return short-lived reset token
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyOtp = (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp   = (req.body.otp   || '').trim();

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP code are required.' });
  }

  const result = verifyOTP(email, otp);

  if (!result.valid) {
    return res.status(400).json({ message: result.message });
  }

  // ✅ OTP valid — issue a 15-minute reset token
  const resetToken = signResetToken(email);

  res.json({
    message: 'Code verified successfully.',
    token:   resetToken,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD  →  validate token + update password
// ─────────────────────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  const email    = (req.body.email    || '').trim().toLowerCase();
  const token    = (req.body.token    || '').trim();
  const password = (req.body.password || '').trim();

  if (!email || !token || !password) {
    return res.status(400).json({ message: 'Email, token, and new password are required.' });
  }

  // ── Validate reset token ──────────────────────────────────────────────────
  const tokenEmail = verifyResetToken(token);

  if (!tokenEmail) {
    return res.status(400).json({
      message: 'Reset link has expired or is invalid. Please start the process again.'
    });
  }

  if (tokenEmail !== email) {
    return res.status(400).json({ message: 'Token does not match the provided email.' });
  }

  // ── Password strength ─────────────────────────────────────────────────────
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      message: 'Password must be at least 8 characters and include a number and a symbol.'
    });
  }

  // ── Check user still exists ───────────────────────────────────────────────
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error.', error: err.message });

    if (results.length === 0) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    const user        = results[0];
    const newHash     = bcrypt.hashSync(password, 10);

    // ── Update password in DB ─────────────────────────────────────────────
    db.query(
      'UPDATE users SET password = ? WHERE email = ?',
      [newHash, email],
      async (err) => {
        if (err) return res.status(500).json({ message: 'Failed to update password.', error: err.message });

        // ── Clean up any leftover OTP ─────────────────────────────────────
        invalidateOTP(email);

        // ── Send security confirmation email ──────────────────────────────
        const firstName = user.first_name || user.name || 'there';
        await sendPasswordChangedEmail(email, firstName);

        res.json({ message: 'Password updated successfully. You can now log in.' });
      }
    );
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN  (unchanged from original — moved secrets to .env)
// ─────────────────────────────────────────────────────────────────────────────
exports.refresh = (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.REFRESH_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403);

    db.query(
      'SELECT * FROM users WHERE id = ? AND refresh_token = ?',
      [decoded.id, token],
      (err, results) => {
        if (err || !results.length) return res.sendStatus(403);

        const user        = results[0];
        const accessToken = jwt.sign(
          { id: user.id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );

        res.json({ accessToken });
      }
    );
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  const token = req.cookies.refreshToken;

  if (token) {
    db.query('UPDATE users SET refresh_token = NULL WHERE refresh_token = ?', [token]);
  }

  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out successfully.' });
};