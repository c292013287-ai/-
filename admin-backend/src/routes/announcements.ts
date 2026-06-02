import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/announcements
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/announcements
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, tag } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容不能为空' });
    }
    const date = new Date().toISOString().slice(0, 10);
    const row = await prisma.announcement.create({
      data: { title, content, tag: tag || '系统', date },
    });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/announcements/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, tag } = req.body;
    const row = await prisma.announcement.update({
      where: { id: Number(req.params.id) },
      data: { title, content, tag },
    });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/announcements/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await prisma.announcement.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
