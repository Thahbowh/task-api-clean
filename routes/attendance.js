const express = require('express');
const router  = express.Router();
const db      = require('../dbPromise');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

/* ════════════════════════════════════════════
   CONFIG — authorized business location(s)
   Add every site you operate from. Radius in metres.
════════════════════════════════════════════ */
const AUTHORIZED_LOCATIONS = [
  // { name: 'Main Bar', lat: -29.8587, lng: 31.0218, radiusMeters: 150 }
  // Replace with your real venue coordinates. Leave empty to disable
  // location restriction entirely (location will still be logged).
];

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinAuthorizedLocation(lat, lng) {
  if (!AUTHORIZED_LOCATIONS.length) return { authorized: true, matched: null }; // no restriction configured
  for (const loc of AUTHORIZED_LOCATIONS) {
    const dist = haversineMeters(lat, lng, loc.lat, loc.lng);
    if (dist <= loc.radiusMeters) return { authorized: true, matched: loc.name, distance: dist };
  }
  return { authorized: false, matched: null };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalise(row) {
  return {
    id:               row.id,
    employeeId:       row.employee_id,
    employeeName:     row.employee_name || null,
    date:             row.date instanceof Date ? row.date.toISOString().slice(0,10) : row.date,
    clockIn:          row.clock_in,
    clockOut:         row.clock_out,
    hoursWorked:      row.hours_worked !== null ? parseFloat(row.hours_worked) : null,
    overtimeHours:    row.overtime_hours !== null ? parseFloat(row.overtime_hours) : null,
    attendanceStatus: row.attendance_status,
    clockInLat:       row.clock_in_latitude  !== null ? parseFloat(row.clock_in_latitude)  : null,
    clockInLng:       row.clock_in_longitude !== null ? parseFloat(row.clock_in_longitude) : null,
    locationLatitude:  row.location_latitude  !== null ? parseFloat(row.location_latitude)  : null,
    locationLongitude: row.location_longitude !== null ? parseFloat(row.location_longitude) : null,
    locationVerified:  !!row.location_verified,
    selfieImageUrl:    row.selfie_image_url,
    notes:             row.notes,
    startCash:         row.start_cash !== null ? parseFloat(row.start_cash) : null,
    endCash:           row.end_cash   !== null ? parseFloat(row.end_cash)   : null,
    cashVariance:      row.cash_variance !== null ? parseFloat(row.cash_variance) : null,
    salesTotal:        row.sales_total !== null ? parseFloat(row.sales_total) : 0,
    transactionCount:  row.transaction_count || 0,
    createdAt:         row.created_at,
    updatedAt:         row.updated_at,
  };
}

/* ════════════════════════════════════════════
   GET /api/attendance/today
   Returns the employee's open (or most recent) record for today
════════════════════════════════════════════ */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const employeeId = req.user.id;
    const [rows] = await db.execute(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ? ORDER BY id DESC LIMIT 1`,
      [employeeId, todayStr()]
    );
    if (!rows.length) return res.json({ record: null });
    res.json({ record: normalise(rows[0]) });
  } catch (err) {
    console.error('GET /attendance/today error:', err.message);
    res.status(500).json({ message: 'Failed to fetch attendance status' });
  }
});

/* ════════════════════════════════════════════
   POST /api/attendance/clock-in
   Body: { latitude, longitude, accuracy }
════════════════════════════════════════════ */
router.post('/clock-in', verifyToken, async (req, res) => {
  const employeeId = req.user.id;
  const { latitude, longitude, accuracy, startCash } = req.body;
  const date = todayStr();

  try {
    const [existing] = await db.execute(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [employeeId, date]
    );
    if (existing.length) {
      return res.status(409).json({ message: 'You are already clocked in for today.', record: normalise(existing[0]) });
    }

    const locCheck = (latitude != null && longitude != null)
      ? isWithinAuthorizedLocation(latitude, longitude)
      : { authorized: true, matched: null };

    const now = new Date();

    const [result] = await db.execute(
      `INSERT INTO attendance
        (employee_id, date, clock_in, attendance_status,
         clock_in_latitude, clock_in_longitude, location_verified,
         start_cash, created_at, updated_at)
       VALUES (?, ?, ?, 'present', ?, ?, ?, ?, ?, ?)`,
      [employeeId, date, now, latitude ?? null, longitude ?? null,
       locCheck.authorized ? 1 : 0, startCash ?? null, now, now]
    );

    const [rows] = await db.execute('SELECT * FROM attendance WHERE id = ?', [result.insertId]);

    res.status(201).json({
      message: 'Clocked in successfully',
      record: normalise(rows[0]),
      locationAuthorized: locCheck.authorized
    });
  } catch (err) {
    console.error('POST /attendance/clock-in error:', err.message);
    res.status(500).json({ message: 'Failed to clock in' });
  }
});

/* ════════════════════════════════════════════
   POST /api/attendance/clock-out
   Body: { latitude, longitude, accuracy, selfieImage, notes, endCash }
════════════════════════════════════════════ */
router.post('/clock-out', verifyToken, async (req, res) => {
  const employeeId = req.user.id;
  const { latitude, longitude, accuracy, selfieImage, notes, endCash } = req.body;
  const date = todayStr();

  try {
    // 1. Must already be clocked in (open session, no clock_out yet)
    const [openRows] = await db.execute(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1`,
      [employeeId, date]
    );

    if (!openRows.length) {
      return res.status(400).json({
        message: 'No active clock-in session found. You must clock in before clocking out.'
      });
    }

    const record = openRows[0];

    // 2. Cannot clock out twice (defensive — query above already filters clock_out IS NULL,
    //    but re-check the specific row in case of a race condition)
    if (record.clock_out) {
      return res.status(409).json({ message: 'This shift has already been clocked out.' });
    }

    const clockIn  = new Date(record.clock_in);
    const clockOut = new Date();

    // 3. Hours worked
    const msWorked     = clockOut - clockIn;
    const hoursWorked   = Math.max(0, msWorked / 1000 / 60 / 60);
    const regularHours  = Math.min(hoursWorked, 8);
    const overtimeHours = Math.max(0, hoursWorked - 8);

    // 4. Location verification at clock-out
    const locCheck = (latitude != null && longitude != null)
      ? isWithinAuthorizedLocation(latitude, longitude)
      : { authorized: true, matched: null };

    // Flag suspicious clock-out: outside authorized premises
    const suspicious = !locCheck.authorized;
    const attendanceStatus = suspicious ? 'flagged' : 'present';

    // 5. Shift sales summary (linked via cashier/staff id on orders table)
    let salesTotal = 0, transactionCount = 0;
    try {
      const [salesRows] = await db.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total),0) AS sum
         FROM orders WHERE user_id = ? AND created_at BETWEEN ? AND ?`,
        [employeeId, clockIn, clockOut]
      );
      transactionCount = salesRows[0]?.cnt || 0;
      salesTotal       = parseFloat(salesRows[0]?.sum || 0);
    } catch (e) {
      console.warn('Sales summary lookup failed (orders table may differ):', e.message);
    }

    const cashVariance = (endCash != null && record.start_cash != null)
      ? parseFloat(endCash) - parseFloat(record.start_cash) - salesTotal
      : null;

    // 6. Persist
    await db.execute(
      `UPDATE attendance SET
         clock_out = ?, hours_worked = ?, overtime_hours = ?, attendance_status = ?,
         location_latitude = ?, location_longitude = ?, location_verified = ?,
         selfie_image_url = ?, notes = ?, end_cash = ?, cash_variance = ?,
         sales_total = ?, transaction_count = ?, updated_at = ?
       WHERE id = ?`,
      [
        clockOut, hoursWorked.toFixed(2), overtimeHours.toFixed(2), attendanceStatus,
        latitude ?? null, longitude ?? null, locCheck.authorized ? 1 : 0,
        selfieImage ?? null, notes ?? null, endCash ?? null, cashVariance,
        salesTotal, transactionCount, clockOut, record.id
      ]
    );

    // 7. Audit log (best-effort — doesn't fail the request if table is missing)
    try {
      await db.execute(
        `INSERT INTO attendance_audit_log (employee_id, action, details, created_at)
         VALUES (?, 'clock_out', ?, ?)`,
        [employeeId, JSON.stringify({ attendanceId: record.id, suspicious, locCheck }), clockOut]
      );
    } catch (e) { /* audit table optional — ignore if not present */ }

    const [updatedRows] = await db.execute('SELECT * FROM attendance WHERE id = ?', [record.id]);
    const final = normalise(updatedRows[0]);

    res.json({
      message: suspicious ? 'Clocked out — flagged for review (outside authorized location)' : 'Clocked out successfully',
      record: final,
      summary: {
        hoursWorked:   parseFloat(hoursWorked.toFixed(2)),
        regularHours:  parseFloat(regularHours.toFixed(2)),
        overtimeHours: parseFloat(overtimeHours.toFixed(2)),
        locationVerified: locCheck.authorized,
        suspicious,
        salesTotal,
        transactionCount,
        cashVariance
      }
    });
  } catch (err) {
    console.error('POST /attendance/clock-out error:', err.message);
    res.status(500).json({ message: 'Failed to clock out' });
  }
});

/* ════════════════════════════════════════════
   GET /api/attendance/my-records  (staff — own records only)
   Query: ?range=week|month|all
════════════════════════════════════════════ */
router.get('/my-records', verifyToken, async (req, res) => {
  const employeeId = req.user.id;
  const range = req.query.range || 'month';

  try {
    let dateClause = '';
    if (range === 'week')  dateClause = 'AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    if (range === 'month') dateClause = 'AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';

    const [rows] = await db.execute(
      `SELECT * FROM attendance WHERE employee_id = ? ${dateClause} ORDER BY date DESC, id DESC`,
      [employeeId]
    );
    res.json(rows.map(normalise));
  } catch (err) {
    console.error('GET /attendance/my-records error:', err.message);
    res.status(500).json({ message: 'Failed to fetch attendance records' });
  }
});

/* ════════════════════════════════════════════
   GET /api/attendance/all  (admin/manager only)
   Query: ?range=week|month|all&employeeId=&status=
════════════════════════════════════════════ */
router.get('/all', verifyToken, checkRole(['admin', 'manager']), async (req, res) => {
  const { range = 'month', employeeId, status } = req.query;

  try {
    const clauses = [];
    const params  = [];

    if (range === 'week')  clauses.push('a.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');
    if (range === 'month') clauses.push('a.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
    if (employeeId) { clauses.push('a.employee_id = ?'); params.push(employeeId); }
    if (status)     { clauses.push('a.attendance_status = ?'); params.push(status); }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await db.execute(
      `SELECT a.*, u.name AS employee_name
       FROM attendance a
       LEFT JOIN users u ON a.employee_id = u.id
       ${where}
       ORDER BY a.date DESC, a.id DESC`,
      params
    );
    res.json(rows.map(normalise));
  } catch (err) {
    console.error('GET /attendance/all error:', err.message);
    res.status(500).json({ message: 'Failed to fetch attendance records' });
  }
});

/* ════════════════════════════════════════════
   GET /api/attendance/summary  (admin/manager)
   Weekly + monthly aggregate report
════════════════════════════════════════════ */
router.get('/summary', verifyToken, checkRole(['admin', 'manager']), async (req, res) => {
  try {
    const [weekRows] = await db.execute(
      `SELECT employee_id, COUNT(*) AS days_worked,
              SUM(hours_worked) AS total_hours, SUM(overtime_hours) AS total_overtime,
              SUM(CASE WHEN attendance_status = 'flagged' THEN 1 ELSE 0 END) AS flagged_count
       FROM attendance
       WHERE date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY employee_id`
    );
    const [monthRows] = await db.execute(
      `SELECT employee_id, COUNT(*) AS days_worked,
              SUM(hours_worked) AS total_hours, SUM(overtime_hours) AS total_overtime,
              SUM(CASE WHEN attendance_status = 'flagged' THEN 1 ELSE 0 END) AS flagged_count
       FROM attendance
       WHERE date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY employee_id`
    );
    res.json({ week: weekRows, month: monthRows });
  } catch (err) {
    console.error('GET /attendance/summary error:', err.message);
    res.status(500).json({ message: 'Failed to generate summary' });
  }
});

module.exports = router;