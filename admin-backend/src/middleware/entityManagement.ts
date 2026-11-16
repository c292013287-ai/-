import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from './auth';

export function entityManagementOnly(req: AuthRequest, res: Response, next: NextFunction) {
  const accessToken = req.headers['x-entity-access-token'];
  if (typeof accessToken !== 'string') {
    res.status(403).json({ code:'REVERIFY', error: '请先验证主体管理访问权限' });
    return;
  }
  try {
    const payload = jwt.verify(accessToken, process.env.JWT_SECRET!) as {
      userId: number;
      scope: string;
      version?: number;
    };
    if (payload.scope !== 'entity-management' || payload.userId !== req.userId || (payload.version ?? 0) !== req.sessionVersion) {
      throw new Error('Invalid entity access token');
    }
    next();
  } catch {
    res.status(403).json({ code:'REVERIFY', error: '主体管理授权已过期，请重新验证' });
  }
}
