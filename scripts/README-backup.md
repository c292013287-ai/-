# 线上数据库自动备份到本地

每天下午 15:00 执行：

1. 从线上服务器导出 `resource_admin` 数据库。
2. 保存一份带时间戳的 SQL 文件到 `backups/prod-db/`。
3. 先备份当前本地库。
4. 将线上数据恢复到本地 Docker MySQL。
5. 清理 30 天前的旧备份文件。

手动执行：

```bash
./scripts/backup-prod-to-local.sh
```

安装 macOS 定时任务：

```bash
mkdir -p ~/Library/LaunchAgents
cp scripts/com.resource-admin.prod-backup.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.resource-admin.prod-backup.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.resource-admin.prod-backup.plist
```

查看日志：

```bash
tail -f backups/prod-db/backup.log
```
