#!/bin/bash
set -e

SERVER="root@47.95.226.204"
SERVER_PATH="/opt/resource-admin"
PROJECT="$(dirname "$0")"

echo "========================================"
echo "  获客监控系统 - 快速前端部署"
echo "========================================"

# 1. 构建前端
echo ""
echo "[1] 构建前端..."
cd "$PROJECT/admin-frontend"
npm run build
echo "  ✅ 前端构建完成"

# 2. 上传 dist
echo ""
echo "[2] 上传到服务器..."
ssh "$SERVER" "mkdir -p $SERVER_PATH/admin-frontend/dist"
rsync -avz --delete dist/ "$SERVER:$SERVER_PATH/admin-frontend/dist/"
echo "  ✅ 上传完成"

# 3. 重载 Nginx（静态文件，无需重启进程）
echo ""
echo "[3] 重载 Nginx..."
ssh "$SERVER" "nginx -s reload"
echo "  ✅ Nginx 已重载"

echo ""
echo "  部署完成 → http://47.95.226.204/"
