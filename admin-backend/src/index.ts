import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import entityRoutes from './routes/entities';
import consumptionRoutes from './routes/consumption';
import dashboardRoutes from './routes/dashboard';
import rechargeRoutes from './routes/recharges';
import announcementRoutes from './routes/announcements';
import { startScheduler } from './services/scheduler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost', process.env.FRONTEND_URL || ''].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// 请求日志
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/consumption', consumptionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/recharges', rechargeRoutes);
app.use('/api/announcements', announcementRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`Admin Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);

  // 启动定时任务
  startScheduler();
});

export default app;
