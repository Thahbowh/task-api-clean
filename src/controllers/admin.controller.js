const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true }
    });
    res.json(users);
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
};

const getAllTasks = async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      include: { user: { select: { id: true, email: true, role: true } } }
    });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
};

const updateUserRole = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { role } = req.body;
    if (!['CUSTOMER', 'WORKER', 'ADMIN'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });
    const user = await prisma.user.update({
      where: { id }, data: { role },
      select: { id: true, email: true, role: true }
    });
    res.json({ message: 'Role updated', user });
  } catch (err) { res.status(404).json({ error: 'User not found' }); }
};

module.exports = { getAllUsers, getAllTasks, updateUserRole };