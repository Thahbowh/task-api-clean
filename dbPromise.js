const mysql = require('mysql2/promise');
require('dotenv').config();

let db;

if (process.env.DATABASE_URL) {
  // Railway provides a full connection URL — use it directly.
  db = mysql.createPool(process.env.DATABASE_URL);
} else {
  // Local development — use individual variables from .env
  db = mysql.createPool({
    host:               process.env.DB_HOST,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME,
    port:               parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit:    10
  });
}

module.exports = db;