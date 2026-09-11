#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="${SERVER:-ubuntu@82.156.205.213}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/resource-admin/admin-backend}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups/prod-db}"
LOCAL_DB="${LOCAL_DB:-resource_admin}"
LOCAL_MYSQL_USER="${LOCAL_MYSQL_USER:-admin}"
LOCAL_MYSQL_PASSWORD="${LOCAL_MYSQL_PASSWORD:-admin123}"
DOCKER_BIN="${DOCKER_BIN:-/Applications/Docker.app/Contents/Resources/bin/docker}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

timestamp="$(date '+%Y%m%d_%H%M%S')"
backup_file="$BACKUP_DIR/prod_resource_admin_$timestamp.sql"
tmp_backup_file="$BACKUP_DIR/.prod_resource_admin_$timestamp.sql.tmp"
local_before_file="$BACKUP_DIR/local_before_restore_$timestamp.sql"
log_file="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$log_file"
}

remote_dump() {
  ssh "$SERVER" "cd '$REMOTE_APP_DIR' && node - <<'NODE'
const fs = require('fs');
const { spawnSync } = require('child_process');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\n/)
    .filter((line) => line && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).replace(/^\"|\"$/g, '')];
    })
);
const url = new URL(env.DATABASE_URL);
const args = [
  '-h' + url.hostname,
  '-P' + (url.port || 3306),
  '-u' + url.username,
  '-p' + url.password,
  '--single-transaction',
  '--routines',
  '--triggers',
  '--no-tablespaces',
  url.pathname.slice(1),
];
const result = spawnSync('mysqldump', args, { stdio: ['ignore', 'inherit', 'inherit'] });
process.exit(result.status || 0);
NODE"
}

log "开始从线上导出数据库"
for attempt in 1 2 3 4 5; do
  if remote_dump > "$tmp_backup_file"; then
    if [ -s "$tmp_backup_file" ]; then
      mv "$tmp_backup_file" "$backup_file"
      break
    fi
    log "第 $attempt 次导出结果为空，准备重试"
  else
    log "第 $attempt 次连接或导出失败，准备重试"
  fi

  rm -f "$tmp_backup_file"
  if [ "$attempt" -eq 5 ]; then
    log "线上导出失败，停止本次备份"
    exit 1
  fi
  sleep 30
done
log "线上备份已保存: $backup_file"

log "备份当前本地数据库"
"$DOCKER_BIN" compose -f "$PROJECT_DIR/docker-compose.yml" exec -T mysql \
  mysqldump -u"$LOCAL_MYSQL_USER" -p"$LOCAL_MYSQL_PASSWORD" \
  --single-transaction --routines --triggers --no-tablespaces "$LOCAL_DB" \
  > "$local_before_file"

log "开始恢复到本地数据库"
"$DOCKER_BIN" compose -f "$PROJECT_DIR/docker-compose.yml" exec -T mysql \
  mysql -u"$LOCAL_MYSQL_USER" -p"$LOCAL_MYSQL_PASSWORD" \
  -e "DROP DATABASE IF EXISTS \`$LOCAL_DB\`; CREATE DATABASE \`$LOCAL_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

"$DOCKER_BIN" compose -f "$PROJECT_DIR/docker-compose.yml" exec -T mysql \
  mysql -u"$LOCAL_MYSQL_USER" -p"$LOCAL_MYSQL_PASSWORD" "$LOCAL_DB" \
  < "$backup_file"

log "本地数据库已同步为线上数据"
log "开始清理 $RETENTION_DAYS 天前的旧备份"
find "$BACKUP_DIR" -type f \( -name 'prod_resource_admin_*.sql' -o -name 'local_before_restore_*.sql' \) -mtime +"$RETENTION_DAYS" -delete
log "备份任务完成"
