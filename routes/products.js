const express = require('express');
const router  = express.Router();
const db      = require('../dbPromise');
const { verifyToken, checkRole } = require('../middleware/auth.middleware');

// GET ALL PRODUCTS (PUBLIC)
router.get('/', async (req, res) => {
  try {
    const [results] = await db.execute('SELECT * FROM products');
    res.json(results);
  } catch (err) {
    console.error('GET products error:', err.message);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// ➕ ADD PRODUCT (ADMIN ONLY)
router.post('/', verifyToken, checkRole(['admin']), async (req, res) => {
  const { name, price, category, img, stock, lowStockThreshold, barcode } = req.body;
  try {
    await db.execute(
      'INSERT INTO products (name, price, category, img, stock, lowStockThreshold, barcode) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, price, category, img, stock ?? 0, lowStockThreshold ?? 5, barcode ?? null]
    );
    res.json({ message: 'Product added successfully' });
  } catch (err) {
    console.error('ADD product error:', err.message);
    res.status(500).json({ error: 'Failed to add product' });
  }
});

// ✏️ UPDATE PRODUCT (ADMIN ONLY)
router.put('/:id', verifyToken, checkRole(['admin']), async (req, res) => {
  const { name, price, category, img, stock, lowStockThreshold, barcode } = req.body;
  try {
    await db.execute(
      'UPDATE products SET name=?, price=?, category=?, img=?, stock=?, lowStockThreshold=?, barcode=? WHERE id=?',
      [name, price, category, img, stock ?? 0, lowStockThreshold ?? 5, barcode ?? null, req.params.id]
    );
    res.json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('UPDATE product error:', err.message);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// ❌ DELETE PRODUCT (ADMIN ONLY)
router.delete('/:id', verifyToken, checkRole(['admin']), async (req, res) => {
  try {
    await db.execute('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error('DELETE product error:', err.message);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;