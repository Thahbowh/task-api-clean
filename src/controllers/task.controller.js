const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const prisma = new PrismaClient();

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title too long'),
  done: z.boolean().optional()
});

const getTasks = async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({ where: { userId: req.userId } });
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
};

const getTask = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
    const task = await prisma.task.findUnique({ where: { id, userId: req.userId } });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
};

const createTask = async (req, res) => {
  try {
    const result = taskSchema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.issues[0].message });
    const task = await prisma.task.create({
      data: { title: result.data.title, userId: req.userId }
    });
    res.status(201).json(task);
  } catch (err) { res.status(500).json({ error: 'Something went wrong' }); }
};

const updateTask = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
    const result = taskSchema.partial().safeParse(req.body);
    if (!result.success)
      return res.status(400).json({ error: result.error.issues[0].message });
    const task = await prisma.task.update({
      where: { id, userId: req.userId }, data: result.data
    });
    res.json(task);
  } catch (err) { res.status(404).json({ error: 'Task not found' }); }
};

const deleteTask = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
    await prisma.task.delete({ where: { id, userId: req.userId } });
    res.json({ message: 'Task deleted' });
  } catch (err) { res.status(404).json({ error: 'Task not found' }); }
};

module.exports = { getTasks, getTask, createTask, updateTask, deleteTask };