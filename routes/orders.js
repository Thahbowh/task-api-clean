const express = require('express');
const router  = express.Router();
const db = require('../dbPromise');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

/* ════════════════════════════════════════════
   HELPER — normalise DB row for frontend
════════════════════════════════════════════ */
function normalise(row) {
  return {
    id:       row.order_id,
    customer: row.customer_name || row.name || (row.user_id ? `User #${row.user_id}` : 'Guest'),
    email:    row.email || '',
    items:    typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    total:    parseFloat(row.total) || 0,
    status:   row.status || 'pending',
    payment:  row.payment || 'cash',
    staffId:  row.staff_id || null,
    time:     row.created_at instanceof Date
                ? row.created_at.toISOString()
                : row.created_at || new Date().toISOString()
  };
}

/* ════════════════════════════════════════════
   POST /api/orders  — place new order (public)
════════════════════════════════════════════ */
router.post('/', async (req, res) => {
  console.log("ORDER HIT ✅");
  const { id, items, total, status, customer, email, payment, staffId } = req.body;

  if (!items || !total) {
    return res.status(400).json({ message: 'items and total are required' });
  }

  const orderId     = id || ('ORD-' + Date.now().toString().slice(-6));
  const orderStatus = status || 'pending';
  const itemsJson   = JSON.stringify(items);

  // Get user_id from token if logged in — null for guests
  let userId = null;
  try {
    const auth = req.headers.authorization;
    if (auth) {
      const jwt     = require('jsonwebtoken');
      const token   = auth.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id || decoded.userId || null;
    }
  } catch (_) { /* guest order — no token */ }

  // ── Determine payment method ──────────────────────────────
  // No staffId attached means this didn't come from the POS — it came
  // from the customer-facing ordering flow, so it's always "online"
  // regardless of what the client tried to send. Staff orders use
  // whichever method (cash/card) the staff member selected.
  const allowedPayments = ['cash', 'card', 'online'];
  let paymentMethod;
  if (!staffId) {
    paymentMethod = 'online';
  } else {
    paymentMethod = allowedPayments.includes(payment) ? payment : 'cash';
  }

  // ── STEP 1: Check every item has enough stock before saving anything ──
  for (const item of items) {
    const productId = item.id || item.product_id || item.productId;
    const qty       = item.qty || item.quantity || 1;

    if (!productId) continue; // skip if no id sent

    try {
      const [rows] = await db.execute(
        'SELECT name, stock FROM products WHERE id = ?',
        [productId]
      );
      if (!rows || rows.length === 0) continue;

      if (rows[0].stock < qty) {
        return res.status(400).json({
          message: `Not enough stock for "${rows[0].name}". Available: ${rows[0].stock}, requested: ${qty}`
        });
      }
    } catch (err) {
      console.error('Stock check error:', err);
    }
  }

  // ── STEP 2: Save the order with customer name, payment, and staffId ──
  try {
    const createdAt = req.body.time ? new Date(req.body.time) : new Date();
    await db.execute(
      `INSERT INTO orders (order_id, user_id, customer_name, items, total, status, payment, staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, userId, customer || null, itemsJson, total, orderStatus, paymentMethod, staffId || null, createdAt]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(201).json({ message: 'Order already saved', id: orderId });
    }
    console.error('DB save error:', err);
    return res.status(500).json({ message: 'Failed to save order' });
  }

  // ── STEP 3: Deduct stock for every item ──
  for (const item of items) {
    const productId = item.id || item.product_id || item.productId;
    const qty       = item.qty || item.quantity || 1;
    if (!productId) continue;
    try {
      await db.execute(
        'UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?',
        [qty, productId]
      );
    } catch (err) {
      console.error(`Stock deduction failed for product ${productId}:`, err.message);
    }
  }

  res.status(201).json({
    message: 'Order saved',
    order: {
      id:       orderId,
      customer: customer || 'Guest',
      items:    items,
      total:    total,
      status:   orderStatus,
      payment:  paymentMethod,
      staffId:  staffId || null,
      time:     new Date().toISOString()
    }
  });
});

/* ════════════════════════════════════════════
   GET /api/orders/status/:id  — public status check
   Customer polls this after placing order
════════════════════════════════════════════ */
router.get('/status/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT order_id, status FROM orders WHERE order_id = ?',
      [req.params.id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({ id: rows[0].order_id, status: rows[0].status });
  } catch (err) {
    console.error("Status route error:", err.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/* ════════════════════════════════════════════
   GET /api/orders/recent  — last 50 (admin/staff)
════════════════════════════════════════════ */
router.get('/recent', verifyToken, checkRole(['admin', 'staff']), async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT o.*, u.name AS customer_name, u.email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC
       LIMIT 50`
    );
    const rows = Array.isArray(result[0]) ? result[0] : result;
    res.json(rows.map(normalise));
  } catch (err) {
    // If users table join fails, fall back to orders only
    console.error('Recent orders error:', err.message);
    try {
      const result = await db.execute(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT 50'
      );
      const rows = Array.isArray(result[0]) ? result[0] : result;
      res.json(rows.map(normalise));
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch recent orders' });
    }
  }
});

/* ════════════════════════════════════════════
   GET /api/orders/my-orders  — customer's own orders
════════════════════════════════════════════ */
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const result = await db.execute(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    const rows = Array.isArray(result[0]) ? result[0] : result;
    res.json(rows.map(normalise));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch your orders' });
  }
});

/* ════════════════════════════════════════════
   GET /api/orders  — all orders (admin only)
════════════════════════════════════════════ */
router.get('/', verifyToken, checkRole(['admin']), async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT o.*, u.name AS customer_name, u.email
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );
    const rows = Array.isArray(result[0]) ? result[0] : result;
    res.json(rows.map(normalise));
  } catch (err) {
    // Fallback without JOIN if users table structure differs
    console.error('Orders fetch error:', err.message);
    try {
      const result = await db.execute(
        'SELECT * FROM orders ORDER BY created_at DESC'
      );
      const rows = Array.isArray(result[0]) ? result[0] : result;
      res.json(rows.map(normalise));
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  }
});

/* ════════════════════════════════════════════
   PUT /api/orders/:id  — update status (admin/staff)
════════════════════════════════════════════ */
router.put('/:id', verifyToken, checkRole(['admin', 'staff']), async (req, res) => {
  const { status, payment } = req.body;
  const { id }     = req.params;

  const allowedStatus  = ['pending', 'completed', 'cancelled'];
  const allowedPayment = ['cash', 'card', 'online'];

  if (status !== undefined && !allowedStatus.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  if (payment !== undefined && !allowedPayment.includes(payment)) {
    return res.status(400).json({ message: 'Invalid payment method' });
  }

  try {
    // Fetch current order state first so we can enforce locking rules
    const [rows] = await db.execute('SELECT * FROM orders WHERE order_id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const order = rows[0];

    // ── Payment lock rules ──────────────────────────────────
    // 1. Online orders haven't actually been paid yet (no payment gateway
    //    is wired up) — the customer pays cash or card when they arrive
    //    at the till. So staff CAN switch online → cash/card, any time,
    //    even if the order is already completed, since marking it
    //    cash/card *is* the act of recording that payment was taken.
    // 2. Cash/card orders can never be switched to "online" — that label
    //    only exists for orders that originated from a no-staffId session.
    // 3. Once an order is cash/card and is completed/cancelled, its
    //    payment is locked — no further edits, by anyone, including
    //    admin, to prevent after-the-fact tampering with reconciled sales.
    //    While pending, staff can still correct a mistaken cash/card choice.
    let nextPayment = order.payment;
    if (payment !== undefined && payment !== order.payment) {
      if (payment === 'online') {
        return res.status(403).json({ message: 'Cash/card orders cannot be changed to online.' });
      }
      if (order.payment !== 'online' && (order.status === 'completed' || order.status === 'cancelled')) {
        return res.status(403).json({ message: `Payment method is locked once an order is ${order.status}.` });
      }
      // order.payment === 'online' → always allowed to switch to cash/card
      // (this is how till payment for online orders gets recorded)
      nextPayment = payment;
    }

    const nextStatus = status !== undefined ? status : order.status;

    const result = await db.execute(
      'UPDATE orders SET status = ?, payment = ? WHERE order_id = ?',
      [nextStatus, nextPayment, id]
    );
    const info = Array.isArray(result[0]) ? result[0] : result;
    if (info.affectedRows === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // ── Audit log ────────────────────────────────────────────
    // Record who changed what, on every status/payment update — not just
    // cancellations — so there's a full trail. This is best-effort: if the
    // audit table is missing or the insert fails for any reason, we log
    // the error but still return success for the actual order update,
    // since a logging failure shouldn't block a legitimate action.
    const statusChanged  = nextStatus  !== order.status;
    const paymentChanged = nextPayment !== order.payment;
    if (statusChanged || paymentChanged) {
      try {
        await db.execute(
          `INSERT INTO order_audit_log
            (order_id, changed_by_id, changed_by_role, old_status, new_status,
             old_payment, new_payment, order_total, customer_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            req.user.id,
            req.user.role || null,
            order.status,
            nextStatus,
            order.payment,
            nextPayment,
            order.total,
            order.customer_name || null,
            new Date(),
          ]
        );
      } catch (auditErr) {
        console.error('Audit log insert failed (order update still succeeded):', auditErr.message);
      }
    }

    res.json({ message: 'Order updated', id, status: nextStatus, payment: nextPayment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

/* ════════════════════════════════════════════
   GET /api/orders/audit-log  — admin only
   View who changed what, on which orders, and when.
   Especially useful for spotting a pattern of cancellations
   by one staff member — query params let you filter.
   ?cancelledOnly=true       → only show changes that resulted in 'cancelled'
   ?changedBy=<userId>       → only show changes made by a specific staff/admin
   ?orderId=<id>             → full history for one specific order
════════════════════════════════════════════ */
router.get('/audit-log', verifyToken, checkRole(['admin']), async (req, res) => {
  try {
    const { cancelledOnly, changedBy, orderId } = req.query;
    const clauses = [];
    const params  = [];

    if (cancelledOnly === 'true') {
      clauses.push('new_status = ?');
      params.push('cancelled');
    }
    if (changedBy) {
      clauses.push('changed_by_id = ?');
      params.push(changedBy);
    }
    if (orderId) {
      clauses.push('order_id = ?');
      params.push(orderId);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await db.execute(
      `SELECT l.*, u.name AS changed_by_name, u.email AS changed_by_email
       FROM order_audit_log l
       LEFT JOIN users u ON l.changed_by_id = u.id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT 200`
    , params);

    res.json(rows);
  } catch (err) {
    console.error('Audit log fetch error:', err.message);
    res.status(500).json({ message: 'Failed to fetch audit log' });
  }
});

module.exports = router;