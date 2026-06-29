/**
 * routes/analytics.js
 * 
 * Mount in server.js:
 *   const { verifyToken, requireRole } = require('./middleware/auth');
 *   const analyticsRoutes = require('./routes/analytics');
 *   app.use('/api/analytics', verifyToken, requireRole('admin'), analyticsRoutes);
 * 
 * Frontend call (from admin.js):
 *   const data = await Auth.apiFetch(`/api/analytics?range=${range}`).then(r => r.json());
 * 
 * Supported ranges: 7d | 30d | 3m | 6m | 1y
 * 
 * Tables assumed (extend schema.sql):
 *   orders  (id, customer_id, customer_name, total, status, payment_method, created_at)
 *   order_items (id, order_id, product_id, product_name, category, quantity, unit_price)
 *   users   (id, name, email, role, created_at)
 */

const router = require('express').Router();
const pool   = require('../db');

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

/**
 * Convert a range string into a PostgreSQL interval and a label.
 * Returns { interval, days, label, prevInterval }
 */
function rangeConfig(range) {
  const map = {
    '7d':  { interval: '7  days',  days: 7,   label: 'last 7 days'   },
    '30d': { interval: '30 days',  days: 30,  label: 'last 30 days'  },
    '3m':  { interval: '3  months',days: 90,  label: 'last 3 months' },
    '6m':  { interval: '6  months',days: 180, label: 'last 6 months' },
    '1y':  { interval: '1  year',  days: 365, label: 'last 12 months'},
  };
  return map[range] || map['7d'];
}

/** Format a number as a Rand string e.g. 12345 → "R12,345" */
function rand(n) {
  return 'R' + Math.round(n).toLocaleString('en-ZA');
}

/** Generate a pct-change label e.g. +12% or -5% */
function changePill(current, previous) {
  if (!previous) return { text: 'No prior data', dir: 'flat' };
  const pct = ((current - previous) / previous) * 100;
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const text = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  return { text, dir };
}

/* ─────────────────────────────────────────────
   GET /api/analytics?range=7d
───────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const range = req.query.range || '7d';
  const { interval, days, label } = rangeConfig(range);

  try {
    // Run all queries in parallel for speed
    const [
      kpiCurrent,
      kpiPrevious,
      revenueTrend,
      categoryBreakdown,
      peakHours,
      paymentMethods,
      bestDays,
      topProducts,
      customerInsights,
      topCustomers,
      smartAlerts,
    ] = await Promise.all([

      /* 1. KPI — current period */
      pool.query(`
        SELECT
          COALESCE(SUM(total), 0)           AS revenue,
          COUNT(*)                           AS orders,
          COUNT(DISTINCT customer_id)        AS customers,
          COALESCE(AVG(total), 0)            AS aov
        FROM orders
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}'
      `),

      /* 2. KPI — previous period (for % change) */
      pool.query(`
        SELECT
          COALESCE(SUM(total), 0)           AS revenue,
          COUNT(*)                           AS orders,
          COUNT(DISTINCT customer_id)        AS customers,
          COALESCE(AVG(total), 0)            AS aov
        FROM orders
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}' * 2
          AND created_at <  NOW() - INTERVAL '${interval}'
      `),

      /* 3. Revenue trend — daily buckets */
      pool.query(`
        SELECT
          DATE_TRUNC('day', created_at)     AS day,
          COALESCE(SUM(total), 0)           AS revenue,
          COUNT(*)                           AS order_count
        FROM orders
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY 1
        ORDER BY 1
      `),

      /* 4. Sales by category */
      pool.query(`
        SELECT
          oi.category,
          SUM(oi.quantity * oi.unit_price)  AS revenue,
          SUM(oi.quantity)                   AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelled'
          AND o.created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY oi.category
        ORDER BY revenue DESC
      `),

      /* 5. Peak hours — orders per hour of the day */
      pool.query(`
        SELECT
          EXTRACT(HOUR FROM created_at)::INT AS hour,
          COUNT(*)                            AS order_count,
          COALESCE(SUM(total), 0)             AS revenue
        FROM orders
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY 1
        ORDER BY 1
      `),

      /* 6. Payment method breakdown */
      pool.query(`
        SELECT
          payment_method,
          COUNT(*)                 AS order_count,
          COALESCE(SUM(total), 0)  AS revenue
        FROM orders
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY payment_method
        ORDER BY order_count DESC
      `),

      /* 7. Best days — avg revenue by weekday (0=Sun … 6=Sat) */
      pool.query(`
        SELECT
          EXTRACT(DOW FROM created_at)::INT   AS dow,
          ROUND(AVG(daily_revenue))            AS avg_revenue
        FROM (
          SELECT
            DATE_TRUNC('day', created_at) AS day,
            EXTRACT(DOW FROM created_at)  AS dow,
            SUM(total)                    AS daily_revenue
          FROM orders
          WHERE status != 'cancelled'
            AND created_at >= NOW() - INTERVAL '${interval}'
          GROUP BY 1, 2
        ) sub
        GROUP BY dow
        ORDER BY dow
      `),

      /* 8. Top products by revenue */
      pool.query(`
        SELECT
          oi.product_name                        AS name,
          oi.category,
          SUM(oi.quantity * oi.unit_price)        AS revenue,
          SUM(oi.quantity)                         AS units,
          COUNT(DISTINCT oi.order_id)              AS order_count
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelled'
          AND o.created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY oi.product_name, oi.category
        ORDER BY revenue DESC
        LIMIT 8
      `),

      /* 9. Customer behaviour stats */
      pool.query(`
        SELECT
          COUNT(DISTINCT CASE WHEN order_count  = 1 THEN customer_id END) AS one_time,
          COUNT(DISTINCT CASE WHEN order_count >= 2 THEN customer_id END) AS returning,
          MAX(total)                                                        AS largest_order,
          MIN(total)                                                        AS smallest_order
        FROM (
          SELECT customer_id, COUNT(*) AS order_count, MAX(total) AS total
          FROM orders
          WHERE status != 'cancelled'
            AND created_at >= NOW() - INTERVAL '${interval}'
          GROUP BY customer_id
        ) sub
      `),

      /* 10. Top 5 spenders */
      pool.query(`
        SELECT
          o.customer_name                    AS name,
          o.customer_id                      AS id,
          SUM(o.total)                       AS spent,
          COUNT(*)                            AS orders
        FROM orders o
        WHERE status != 'cancelled'
          AND created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY o.customer_id, o.customer_name
        ORDER BY spent DESC
        LIMIT 5
      `),

      /* 11. Smart alerts — low stock items */
      pool.query(`
        SELECT name, stock, category
        FROM products
        WHERE stock <= 5
        ORDER BY stock ASC
        LIMIT 5
      `),
    ]);

    /* ── Build KPI diff ── */
    const cur  = kpiCurrent.rows[0];
    const prev = kpiPrevious.rows[0];

    const kpi = {
      revenue:   { value: rand(cur.revenue),  change: changePill(+cur.revenue,  +prev.revenue)  },
      orders:    { value: +cur.orders,         change: changePill(+cur.orders,   +prev.orders)   },
      customers: { value: +cur.customers,      change: changePill(+cur.customers,+prev.customers)},
      aov:       { value: rand(cur.aov),       change: changePill(+cur.aov,      +prev.aov)      },
    };

    /* ── Best day label ── */
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const bestDayRow = [...bestDays.rows].sort((a,b) => b.avg_revenue - a.avg_revenue)[0];
    kpi.bestDay = bestDayRow
      ? { label: dayNames[bestDayRow.dow], value: rand(bestDayRow.avg_revenue) }
      : { label: '—', value: '' };

    /* ── Revenue trend — fill gaps with 0 ── */
    const trendMap = {};
    revenueTrend.rows.forEach(r => {
      trendMap[r.day.toISOString().slice(0, 10)] = {
        revenue: +r.revenue,
        orders: +r.order_count,
      };
    });
    // Fill every day in range with 0 if no orders that day
    const trendLabels = [];
    const trendRevenue = [];
    const trendOrders  = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trendLabels.push(key);
      trendRevenue.push(trendMap[key]?.revenue || 0);
      trendOrders.push(trendMap[key]?.orders  || 0);
    }

    /* ── Category totals ── */
    const catTotal = categoryBreakdown.rows.reduce((s, r) => s + +r.revenue, 0);
    const categories = categoryBreakdown.rows.map(r => ({
      name:    r.category,
      revenue: +r.revenue,
      units:   +r.units,
      pct:     catTotal ? Math.round((+r.revenue / catTotal) * 100) : 0,
    }));

    /* ── Peak hours — fill 0–23 ── */
    const hoursMap = {};
    peakHours.rows.forEach(r => { hoursMap[r.hour] = { orders: +r.order_count, revenue: +r.revenue }; });
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`,
      orders:  hoursMap[h]?.orders  || 0,
      revenue: hoursMap[h]?.revenue || 0,
    }));
    const peakHour = hours.reduce((a, b) => b.orders > a.orders ? b : a, hours[0]);

    /* ── Best days — fill missing weekdays ── */
    const dowMap = {};
    bestDays.rows.forEach(r => { dowMap[r.dow] = +r.avg_revenue; });
    const weekdays = dayNames.map((name, i) => ({
      name: name.slice(0, 3), // Mon, Tue …
      avg: dowMap[i] || 0,
    }));

    /* ── Top products ── */
    const maxRev = +topProducts.rows[0]?.revenue || 1;
    const products = topProducts.rows.map((r, i) => ({
      rank:    i + 1,
      name:    r.name,
      category: r.category,
      revenue: +r.revenue,
      units:   +r.units,
      orders:  +r.order_count,
      barPct:  Math.round((+r.revenue / maxRev) * 100),
    }));

    /* ── Customer insights ── */
    const ci = customerInsights.rows[0] || {};
    const customers = {
      oneTime:      +ci.one_time      || 0,
      returning:    +ci.returning     || 0,
      largestOrder: +ci.largest_order || 0,
    };

    /* ── Smart alerts ── */
    const alerts = [];
    if (smartAlerts.rows.length) {
      const names = smartAlerts.rows.map(r => r.name).join(', ');
      alerts.push({
        type: 'warn',
        icon: '⚠️',
        text: `Low stock: ${names}. Consider restocking before the weekend.`,
      });
    }
    if (+cur.revenue > +prev.revenue * 1.2) {
      alerts.push({
        type: 'success',
        icon: '🚀',
        text: `Revenue is up ${changePill(+cur.revenue, +prev.revenue).text} compared to the previous period — great performance!`,
      });
    }
    if (+cur.orders === 0) {
      alerts.push({
        type: 'info',
        icon: 'ℹ️',
        text: `No orders recorded in the selected range. Try a wider time window.`,
      });
    }

    /* ── Payment methods ── */
    const payments = paymentMethods.rows.map(r => ({
      method: r.payment_method || 'Unknown',
      count:  +r.order_count,
      revenue: +r.revenue,
    }));

    /* ─── Final response ─── */
    res.json({
      range,
      label,
      kpi,
      trend: {
        labels:  trendLabels,
        revenue: trendRevenue,
        orders:  trendOrders,
      },
      categories,
      hours,
      peakHour,
      weekdays,
      products,
      customers,
      topCustomers: topCustomers.rows.map(r => ({
        name:   r.name,
        spent:  +r.spent,
        orders: +r.orders,
      })),
      payments,
      alerts,
    });

  } catch (err) {
    console.error('[Analytics]', err);
    res.status(500).json({ error: 'Failed to load analytics', detail: err.message });
  }
});

module.exports = router;