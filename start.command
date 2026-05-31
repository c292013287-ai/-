#!/bin/bash
# 获客助手监控系统 - 启动脚本
# 双击运行，浏览器自动打开

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/Users/zhanglei/.workbuddy/binaries/node/versions/22.22.2/bin/node"
PYTHON="/Users/zhanglei/.workbuddy/binaries/python/versions/3.13.12/bin/python3"

echo "========================================"
echo "  获客助手监控系统"
echo "========================================"

# 清理旧进程
echo "[1/3] 清理旧进程..."
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
sleep 1

# 启动后端
echo "[2/3] 启动后端 API..."
cd "$DIR/admin-backend"
$NODE dist/index.js &
sleep 2

if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "       Backend: http://localhost:3001  OK"
else
    echo "       后端启动失败!"
    exit 1
fi

# 启动前端
echo "[3/3] 启动前端页面..."
cd "$DIR"
$PYTHON serve.py 5173 &
sleep 1

echo "       Frontend: http://localhost:5173  OK"
echo ""
echo "========================================"
echo "  访问: http://localhost:5173"
echo "  账号: admin / 密码: admin123"
echo "========================================"
echo "  关闭此窗口停止所有服务"
open http://localhost:5173

# 保持运行
wait
