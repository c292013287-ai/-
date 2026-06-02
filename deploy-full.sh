#!/bin/bash
set -e

SERVER="root@47.95.226.204"
SERVER_PATH="/opt/resource-admin"
PROJECT="$(dirname "$0")"

echo "========================================"
echo "  获客监控系统 - 全量部署"
echo "========================================"

# 1. 构建前端
echo ""
echo "[1/4] 构建前端..."
cd "$PROJECT/admin-frontend"
npm run build
echo "  ✅ 前端构建完成"

# 2. 上传前端
echo ""
echo "[2/4] 上传前端..."
ssh "$SERVER" "mkdir -p $SERVER_PATH/admin-frontend/dist"
rsync -avz --delete dist/ "$SERVER:$SERVER_PATH/admin-frontend/dist/"
echo "  ✅ 前端上传完成"

# 3. 构建后端
echo ""
echo "[3/4] 构建并上传后端..."
cd "$PROJECT/admin-backend"
npm run build
rsync -avz --delete dist/ "$SERVER:$SERVER_PATH/admin-backend/dist/"
rsync -avz --delete prisma/ "$SERVER:$SERVER_PATH/admin-backend/prisma/"
rsync -avz package.json package-lock.json "$SERVER:$SERVER_PATH/admin-backend/"
echo "  ✅ 后端上传完成"

# 4. 服务器重启服务
echo ""
echo "[4/4] 服务器重启服务..."
ssh "$SERVER" << 'ENDSSH'
cd /opt/resource-admin/admin-backend
npm install --production
npx prisma generate
pm2 restart resource-backend || pm2 start dist/index.js --name resource-backend
pm2 save
echo "✅ PM2 重启完成"
ENDSSH

echo ""
echo "  部署完成 → http://47.95.226.204/"
