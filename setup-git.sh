#!/bin/bash
# 初次部署脚本 - Xcode CLT 安装完成后运行此脚本
# 用法: bash setup-git.sh

set -e

echo "=== 1. 初始化 Git 仓库 ==="
git init

echo "=== 2. 添加所有文件 ==="
git add -A

echo "=== 3. 首次提交 ==="
git commit -m "feat: 初始化多主体企微获客助手消耗监控系统

- 后端: Express + TypeScript + Prisma + MySQL
- 前端: React 18 + Vite + Ant Design 5 + Zustand
- 部署: Docker Compose + Nginx
- 企微集成: 获客助手 API 服务层 + 定时同步
- 数据模型: User / WecomEntity / ConsumptionRecord / SyncLog"

echo ""
echo "=== 准备就绪 ==="
echo "接下来，请选择推送方式："
echo ""
echo "方式 A - 推送到 GitHub（推荐）:"
echo "  1. 在 GitHub 创建新仓库（不要勾选 README/.gitignore）"
echo "  2. 运行以下命令："
echo "     git remote add origin https://github.com/你的用户名/仓库名.git"
echo "     git branch -M main"
echo "     git push -u origin main"
echo ""
echo "方式 B - 仅本地管理:"
echo "  仓库已在本地初始化，可以随时提交和查看历史"
