import prisma from './prisma';

// Additive, independently rollbackable storage. Never alter existing business tables.
export async function ensureCustomerLiveSchema() {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS customer_live_state (
      entity_id INT NOT NULL, fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
      ready BOOLEAN NOT NULL DEFAULT FALSE, source_file VARCHAR(100) NOT NULL DEFAULT '',
      import_rows BIGINT NOT NULL DEFAULT 0, meta JSON NULL,
      increment_ms BIGINT NOT NULL DEFAULT 0, event_ms BIGINT NOT NULL DEFAULT 0,
      revision BIGINT NOT NULL DEFAULT 0, error VARCHAR(250) NOT NULL DEFAULT '',
      active_count BIGINT NULL,
      PRIMARY KEY(entity_id,fingerprint)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS customer_live_relations (
      entity_id INT NOT NULL, fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
      relation_key CHAR(64) CHARACTER SET ascii NOT NULL,
      user_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      external_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      added_at BIGINT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE,
      observed_ms BIGINT NOT NULL, generation VARCHAR(100) NOT NULL DEFAULT '', payload JSON NOT NULL,
      PRIMARY KEY(entity_id,fingerprint,relation_key),
      INDEX customer_added(entity_id,fingerprint,deleted,added_at,relation_key),
      INDEX customer_employee(entity_id,fingerprint,user_id,deleted,added_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS customer_live_employees (
      entity_id INT NOT NULL, fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
      user_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      checked_ms BIGINT NOT NULL DEFAULT 0, full_ms BIGINT NOT NULL DEFAULT 0,
      due_ms BIGINT NOT NULL DEFAULT 0, failures INT NOT NULL DEFAULT 0,
      error VARCHAR(250) NOT NULL DEFAULT '', scan JSON NULL,
      PRIMARY KEY(entity_id,fingerprint,user_id), INDEX customer_due(due_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS customer_live_tasks (
      task_key CHAR(64) CHARACTER SET ascii PRIMARY KEY, entity_id INT NOT NULL,
      fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
      user_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL, external_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      requested_ms BIGINT NOT NULL, due_ms BIGINT NOT NULL DEFAULT 0,
      failures INT NOT NULL DEFAULT 0, error VARCHAR(250) NOT NULL DEFAULT '', INDEX customer_task_due(due_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS customer_live_events (
      event_key CHAR(64) CHARACTER SET ascii PRIMARY KEY, entity_id INT NOT NULL,
      received_ms BIGINT NOT NULL, INDEX customer_event_age(received_ms)
    ) ENGINE=InnoDB`,
  ]) await prisma.$executeRawUnsafe(sql);
  const columns = await prisma.$queryRawUnsafe<any[]>(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_live_state' AND COLUMN_NAME='active_count'`);
  if (!columns.length) await prisma.$executeRawUnsafe('ALTER TABLE customer_live_state ADD COLUMN active_count BIGINT NULL');
}
