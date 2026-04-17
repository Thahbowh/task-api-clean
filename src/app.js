const express = require('express');
const app = express();

app.use(express.json());



// Routes
app.use('/auth', require('./routes/auth.routes'));
app.use('/tasks', require('./routes/task.routes'));
app.use('/admin', require('./routes/admin.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

module.exports = app;