// routes/auth.routes.js
// ─────────────────────────────────────────────────────────────────────────────
// All /auth/* routes wired to auth.controller.js
// This file replaces both the old auth.js AND auth.routes.js — keep only this one.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();

const {
  register,
  login,
  forgotPassword,
  verifyOtp,
  resetPassword,
  refresh,
  logout,
} = require('../controllers/auth.controller');

// Per-route limiters — each endpoint here has a different abuse pattern,
// so each gets its own tuned limit rather than sharing one blanket rule.
const {
  loginLimiter,
  registerLimiter,
  otpLimiter,
  refreshLimiter,
} = require('../middleware/rateLimiters');

// ── Existing endpoints (unchanged) ───────────────────────────────────────────
router.post('/register', registerLimiter, register);
router.post('/login',    loginLimiter,    login);
router.post('/refresh',  refreshLimiter,  refresh);
router.post('/logout',   refreshLimiter,  logout);

// ── New forgot-password flow ─────────────────────────────────────────────────
// All three steps share the OTP limiter since they're one continuous flow —
// someone brute-forcing a code would hit verify-otp specifically, but the
// same tight limit on forgot-password/reset-password stops them from just
// requesting a flood of new OTPs to work around it.
router.post('/forgot-password',  otpLimiter, forgotPassword);   // Step 1: send OTP email
router.post('/verify-otp',       otpLimiter, verifyOtp);         // Step 2: validate OTP → reset token
router.post('/reset-password',   otpLimiter, resetPassword);     // Step 3: set new password

module.exports = router;