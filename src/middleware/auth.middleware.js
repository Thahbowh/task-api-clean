const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mysecretkey123';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.userRole !== 'ADMIN')
    return res.status(403).json({ error: 'Admins only' });
  next();
};

const isWorker = (req, res, next) => {
  if (req.userRole !== 'WORKER')
    return res.status(403).json({ error: 'Workers only' });
  next();
};

const isAdminOrWorker = (req, res, next) => {
  if (req.userRole !== 'ADMIN' && req.userRole !== 'WORKER')
    return res.status(403).json({ error: 'Access denied' });
  next();
};

module.exports = { authenticate, isAdmin, isWorker, isAdminOrWorker };