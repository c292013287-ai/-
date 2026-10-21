import { Router, Response, RequestHandler } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { entityManagementOnly } from '../middleware/entityManagement';
import { noteInput, todoInput, positiveInteger, WorkbenchError } from '../lib/workbenchInput';

const router = Router();
router.use(authMiddleware, entityManagementOnly);

function handle(action: (req: AuthRequest, res: Response, userId: number) => Promise<void>): RequestHandler {
  return (req: AuthRequest, res) => {
    void (async () => {
      const userId = positiveInteger(req.userId);
      await action(req, res, userId);
    })().catch(error => {
      if (error instanceof WorkbenchError) res.status(error.status).json({ error: error.message });
      else {
        console.error('[Workbench] Request failed', error);
        res.status(500).json({ error: '工作台数据操作失败，请稍后重试' });
      }
    });
  };
}

function conflict() { throw new WorkbenchError(409, '此记录已被更新，请刷新列表后重试；当前编辑内容未保存'); }
function missing() { throw new WorkbenchError(404, '记录不存在或已删除'); }

router.get('/notes', handle(async (_req, res, userId) => {
  res.json(await prisma.workbenchNote.findMany({ where: { userId }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }] }));
}));

router.post('/notes', handle(async (req, res, userId) => {
  res.status(201).json(await prisma.workbenchNote.create({ data: { ...noteInput(req.body), userId } }));
}));

router.put('/notes/:id', handle(async (req, res, userId) => {
  const id = positiveInteger(Number(req.params.id));
  const version = positiveInteger(req.body?.version);
  const data = noteInput(req.body);
  if (!await prisma.workbenchNote.findFirst({ where: { id, userId } })) missing();
  const result = await prisma.workbenchNote.updateMany({ where: { id, userId, version }, data: { ...data, version: { increment: 1 } } });
  if (!result.count) conflict();
  res.json(await prisma.workbenchNote.findFirst({ where: { id, userId } }));
}));

router.delete('/notes/:id', handle(async (req, res, userId) => {
  const id = positiveInteger(Number(req.params.id));
  const version = positiveInteger(req.body?.version);
  if (!await prisma.workbenchNote.findFirst({ where: { id, userId } })) missing();
  const result = await prisma.workbenchNote.deleteMany({ where: { id, userId, version } });
  if (!result.count) conflict();
  res.json({ success: true });
}));

router.get('/todos', handle(async (_req, res, userId) => {
  res.json(await prisma.workbenchTodo.findMany({ where: { userId }, orderBy: [{ completed: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }] }));
}));

router.post('/todos', handle(async (req, res, userId) => {
  const data = todoInput(req.body);
  res.status(201).json(await prisma.workbenchTodo.create({ data: { ...data, userId, completedAt: data.completed ? new Date() : null } }));
}));

router.put('/todos/:id', handle(async (req, res, userId) => {
  const id = positiveInteger(Number(req.params.id));
  const version = positiveInteger(req.body?.version);
  const data = todoInput(req.body);
  const current = await prisma.workbenchTodo.findFirst({ where: { id, userId } });
  if (!current) return missing();
  const result = await prisma.workbenchTodo.updateMany({ where: { id, userId, version }, data: {
    ...data, completedAt: data.completed ? current.completedAt || new Date() : null, version: { increment: 1 },
  } });
  if (!result.count) conflict();
  res.json(await prisma.workbenchTodo.findFirst({ where: { id, userId } }));
}));

router.delete('/todos/:id', handle(async (req, res, userId) => {
  const id = positiveInteger(Number(req.params.id));
  const version = positiveInteger(req.body?.version);
  if (!await prisma.workbenchTodo.findFirst({ where: { id, userId } })) missing();
  const result = await prisma.workbenchTodo.deleteMany({ where: { id, userId, version } });
  if (!result.count) conflict();
  res.json({ success: true });
}));

export default router;
