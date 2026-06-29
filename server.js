require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');
const https        = require('https');
const fs           = require('fs');

const app = express();

// ─── Frontend path (one level up from backend/) ────────────────
const frontendPath = path.join(__dirname, '..', 'frontend');

// ─── 1. CORS ───────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://192.168.8.152:5000"
  ],
  credentials: true
}));

// ─── 2. Body parsers ───────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ─── 3. Serve static frontend files ────────────────────────────
app.use(express.static(frontendPath));

// ─── 4. Rate limiting ───────────────────────────────────────────
// General limiter applies to everything as a baseline safety net.
// Specific limiters (orders, attendance, products, users) are applied
// per-route below, layered on top of this one. Auth sub-routes
// (login, register, OTP, etc.) each have their OWN limiter defined
// inside auth.routes.js itself, since they need different rules —
// so /auth is NOT given a blanket limiter here, to avoid double-limiting.
const { generalLimiter, orderCreateLimiter, attendanceLimiter, productsLimiter, usersLimiter } =
  require('./middleware/rateLimiters');
app.use(generalLimiter);

// ─── 5. Routes ─────────────────────────────────────────────────
const authRoutes       = require('./routes/auth.routes');
const analyticsRoutes  = require('./routes/analytics');
const userRoutes       = require('./routes/users');
const productRoutes    = require('./routes/products');
const orderRoutes      = require('./routes/orders');
const attendanceRoutes = require('./routes/attendance');
const { verifyToken, checkRole } = require('./middleware/auth.middleware');

// auth.routes.js applies its own per-endpoint limiters internally
// (login, register, refresh, OTP flow each tuned differently).
app.use('/auth', authRoutes);

app.use('/api/analytics',  verifyToken, checkRole(['admin']), analyticsRoutes);
app.use('/users',          usersLimiter, userRoutes);
app.use('/products',       productsLimiter, productRoutes);

// Order creation (POST /api/orders) gets its own limiter layered on
// top of the route. We apply it to the whole /api/orders path — GET
// requests are cheap reads and stay covered by the general limiter,
// while this extra layer specifically protects the create endpoint
// since express-rate-limit only blocks once the count is exceeded
// regardless of HTTP method on that path.
app.use('/api/orders', orderCreateLimiter, orderRoutes);

app.use('/api/attendance', attendanceLimiter, attendanceRoutes);

// ─── 6. Serve index.html for all non-API routes ────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── 7. Global error handler ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Server error', error: err.message });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled error:', reason);
});

// ─── 8. Start (HTTPS, with HTTP fallback if cert files are missing) ────
const PORT = process.env.PORT || 5000;

try {
  const httpsOptions = {
    key:  fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
  };

  https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
    console.log(`🔒 Server running on https://localhost:${PORT} (HTTPS)`);
  });
} catch (err) {
  console.warn('⚠️  Could not load cert.pem/key.pem — falling back to plain HTTP.');
  console.warn('   Run "node generate-cert.js" to create them, then restart.');
  console.warn(`   (${err.message})`);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT} (HTTP — not encrypted)`);
  });
}