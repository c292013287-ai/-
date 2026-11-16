import { Request, Response, NextFunction } from 'express';
import {audit} from '../lib/securityAudit';
import prisma from '../lib/prisma';
import { permissions, roleNames } from '../lib/permissions';
import { allowed } from './scope';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  sessionVersion?: number;
  permissions?: string[];
  entityIds?: number[];
  body: any;
  params: any;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录，请先登录' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ error: '登录已过期，请重新登录' }); }
  if (typeof decoded !== 'object' || decoded.scope || !Number.isSafeInteger(decoded.userId) || !decoded.role)
    return res.status(401).json({ error: '无效登录凭证' });
  try {
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: {
      role: true, status: true, sessionVersion: true, grants: { select: { entityId: true } },
    } });
    if (!user || user.status !== 'active' || !Object.hasOwn(roleNames,user.role) || (decoded.version ?? 0) !== user.sessionVersion || decoded.role !== user.role)
      return res.status(401).json({ error: '账号或权限已变更，请重新登录' });
    req.userId = decoded.userId; req.userRole = user.role; req.sessionVersion = user.sessionVersion;
    req.entityIds = user.grants.map(g => g.entityId);
    const override = user.role !== 'admin' ? await prisma.rolePolicy.findUnique({ where: { role: user.role } }) : null;
    req.permissions = permissions(user.role, override?.permissions);
    res.setHeader('Cache-Control','no-store');
    if (!allowed(req)) return res.status(403).json({ error: '未获该操作或主体的授权' });
    if(req.method==='DELETE' && /^\/(?:notes\/|todos\/)?\d+\/?$/.test(req.path)) {
      const target=req.path.split('/').filter(Boolean).pop()!;
      res.once('finish',()=>{void audit(req.userId!,res.statusCode<400?'删除成功':'删除未完成',req.baseUrl.split('/').pop()+':'+target).catch(()=>console.error('[Audit] 记录失败'));});
    }
    next();
  } catch { res.status(503).json({ error: '暂时无法验证权限' }); }
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: '无权限访问' });
    return;
  }
  next();
}
