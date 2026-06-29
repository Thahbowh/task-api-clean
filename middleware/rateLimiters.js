const rateLimit = require('express-rate-limit');

/* ════════════════════════════════════════════
   RATE LIMITERS
   Each limiter tracks requests per IP address. When the
   limit is hit, Express responds with 429 Too Many Requests
   automatically — no need to handle that yourself.
════════════════════════════════════════════ */

// ── LOGIN — the most important one ──────────────────────
// Brute-forcing passwords means many failed attempts in a short time.
// 5 attempts per 15 minutes per IP is generous for a real person who
// mistyped their password, but useless for a brute-force script.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please wait 15 minutes and try again.' },
  // Optional: skip counting successful logins, so a staff member who
  // mistypes once then gets it right isn't penalised for later actions.
  skipSuccessfulRequests: true,
});

// ── REGISTRATION ─────────────────────────────────────────
// A real person registers an account once, maybe twice if they fumble
// a field. More than that in a short window is almost always a bot
// farming fake accounts.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many registration attempts from this device. Please try again later.' },
});

// ── FORGOT PASSWORD / OTP / RESET ────────────────────────
// This is the most attackable part of the auth flow: an OTP is usually
// a short numeric code, and someone could try to brute-force it by
// hammering /auth/verify-otp repeatedly. A tight limit here matters
// more than almost anywhere else in the app.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please wait 15 minutes before trying again.' },
});

// ── REFRESH / LOGOUT ──────────────────────────────────────
// These are called automatically by the frontend (e.g. silently
// refreshing a token) and shouldn't be capped anywhere near as tight
// as login — a legitimate session can call refresh many times an hour.
// This just stops outright abuse/flooding of the endpoint.
const refreshLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

// ── ORDER CREATION ──────────────────────────────────────
// Generous enough for a busy till ringing up many orders per minute,
// but blocks a flood/script attack that could exhaust stock or spam
// your database with fake orders.
const orderCreateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many orders submitted too quickly. Please slow down.' },
});

// ── ATTENDANCE CLOCK IN/OUT ──────────────────────────────
// Clocking in/out should happen at most a couple of times per shift.
// This mainly guards against a buggy client retry-looping the endpoint
// or someone probing it rapidly.
const attendanceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attendance requests. Please wait a few minutes and try again.' },
});

// ── PRODUCTS (read-heavy, but still worth a ceiling) ─────
// /products is public (no login required) and gets polled by staff.html
// every few seconds for stock sync, plus normal customer browsing. The
// limit here is generous enough to never affect real usage, but stops a
// scraper or flood script from hammering it nonstop.
const productsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // covers multiple tills polling every 2-4s plus normal browsing
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

// ── USERS (profile updates etc.) ─────────────────────────
// Normal usage here is occasional (viewing/editing a profile), so this
// can be tighter than products without risking false positives.
const usersLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

// ── GENERAL API SAFETY NET ───────────────────────────────
// Applied globally as a baseline. Generous limit so normal POS usage
// (polling for new orders every 2s, stock refresh every 4s, etc.) is
// never affected — this exists purely to stop a runaway script or
// malicious flood from taking the server down.
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // ~5 requests/second sustained — comfortably above normal polling load
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  otpLimiter,
  refreshLimiter,
  orderCreateLimiter,
  attendanceLimiter,
  productsLimiter,
  usersLimiter,
  generalLimiter,
};