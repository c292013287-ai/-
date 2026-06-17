#!/bin/bash
set -e

SERVER="ubuntu@82.156.205.213"
SERVER_PATH="/opt/resource-admin"
BACKEND_NAME="admin-backend"

echo "========================================"
echo "  获客监控系统 - 生产环境部署"
echo "========================================"

# 1. 构建前端
echo ""
echo "[1/4] 构建前端..."
cd "$(dirname "$0")/admin-frontend"
npm run build
echo "  ✅ 前端构建完成"

# 2. 上传前端 dist
echo ""
echo "[2/4] 上传前端文件..."
ssh "$SERVER" "mkdir -p $SERVER_PATH/admin-frontend/dist"
rsync -avz --delete dist/ "$SERVER:$SERVER_PATH/admin-frontend/dist/"
echo "  ✅ 前端上传完成"

# 3. 同步后端代码
echo ""
echo "[3/4] 同步后端代码..."
cd "$(dirname "$0")/admin-backend"
rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='dev.db' \
    --exclude='.env' \
    src/ prisma/ package.json package-lock.json tsconfig.json \
    "$SERVER:$SERVER_PATH/$BACKEND_NAME/"
echo "  ✅ 后端代码同步完成"

# 4. 在服务器上安装依赖并重启
echo ""
echo "[4/4] 服务器安装依赖并重启..."
ssh "$SERVER" << 'ENDSSH'
cd /opt/resource-admin/admin-backend
npm install --production
npx prisma generate
pm2 restart admin-backend || pm2 start dist/index.js --name admin-backend
pm2 save
echo "  ✅ 服务重启完成"
ENDSSH

echo ""
echo "========================================"
echo "  部署完成！"
echo "  访问: http://82.156.205.213/"
echo "========================================"
