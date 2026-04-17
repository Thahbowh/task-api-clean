const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'mysecretkey123';

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['CUSTOMER', 'WORKER', 'ADMIN']).optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
});

const register = async (req, res) => {
  try {
    const result = registerSchema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.issues[0].message });

    const { email, password, role } = result.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role: role || 'CUSTOMER' }
    });

    res.status(201).json({ message: 'User created', userId: user.id, role: user.role });

  } catch (err) {
    console.log('Register error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

const login = async (req, res) => {
  try {
    const result = loginSchema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.issues[0].message });

    const { email, password } = result.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, role: user.role });

  } catch (err) {
    console.log('Login error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

module.exports = { register, login };