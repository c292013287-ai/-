import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import {audit} from '../lib/securityAudit';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: '请输入用户名和密码' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || user.status !== 'active') {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, version: user.sessionVersion },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, username: true, name: true, role: true, status: true, createdAt: true },
    });

    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    res.json({ ...user, permissions: req.permissions });
  } catch (error) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

// Browser-generated workbooks and local migration deletions have no server download endpoint.
router.post('/events',authMiddleware,async(req:AuthRequest,res)=>{
  const labels: Record<string,string>={entities:'申请导出主体',customers:'申请导出客户',recharges:'申请导出充值',migration:'申请导出迁移',removeMigration:'申请删除迁移记录'};
  const key=req.body?.operation;
  if(typeof key!=='string'||!Object.hasOwn(labels,key))return res.status(400).end();
  try{await audit(req.userId!,labels[key],String(Number.isSafeInteger(req.body.id)?req.body.id:'-'));res.sendStatus(204);}
  catch{res.status(503).json({error:'安全操作记录暂不可用'});}
});
export default router;
