# Resource Admin

多主体企微获客助手消耗监控系统，包含管理后台前端、Express API 服务、Prisma 数据模型和 Docker Compose 部署配置。

## 技术栈

- 前端：React、TypeScript、Vite、Ant Design、Zustand、Axios
- 后端：Node.js、Express、TypeScript、Prisma
- 数据库：MySQL 8.0
- 部署：Docker Compose、Nginx

## 开发标准

- 数据库以 MySQL 为唯一标准环境；`admin-backend/prisma/schema.prisma` 不再使用 SQLite provider。
- 环境变量从 `admin-backend/.env.example` 复制生成 `admin-backend/.env`，不要提交真实 `.env`。
- 前端 API 统一走 `/api` 前缀，生产环境由 Nginx 代理到后端。
- 后端新增接口统一放在 `admin-backend/src/routes`，共享逻辑放在 `admin-backend/src/lib` 或 `admin-backend/src/services`。
- Prisma schema 字段使用 camelCase，数据库列名继续通过 `@map` 使用 snake_case。
- 提交前至少执行对应模块的类型检查或构建命令，避免提交 `dist`、日志、本地数据库和依赖目录。

## 本地启动

启动 MySQL：

```bash
docker compose up -d mysql
```

初始化后端环境：

```bash
cd admin-backend
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

启动前端：

```bash
cd admin-frontend
npm install
npm run dev
```

默认账号：

```text
admin / admin123
```

## 校验命令

前端：

```bash
cd admin-frontend
npm run lint
npm run build
```

后端：

```bash
cd admin-backend
npm run build
```

## Docker 部署

```bash
docker compose up -d --build
```

服务端口：

- Nginx 入口：http://localhost
- 前端容器：http://localhost:3000
- 后端 API：http://localhost:3001/api/health
- MySQL：localhost:3307
