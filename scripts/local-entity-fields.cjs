const fs = require('node:fs');
const path = require('node:path');
const backend = path.join(__dirname, '../admin-backend');
require(path.join(backend, 'node_modules/dotenv')).config({ path: path.join(backend, '.env') });
const { PrismaClient } = require(path.join(backend, 'node_modules/@prisma/client'));
const prisma = new PrismaClient();
const fields = {
  certification_expires_at: 'DATE NULL',
  served_user_count: 'INTEGER NULL',
  served_user_count_updated_at: 'DATETIME(3) NULL',
};

async function main() {
  const [mode, file] = process.argv.slice(2);
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/resource_admin') {
    throw new Error('Local field preservation requires the local resource_admin database');
  }
  if (!file || !['snapshot', 'restore'].includes(mode)) throw new Error('Expected snapshot/restore and snapshot path');
  const columns = await prisma.$queryRawUnsafe('SHOW COLUMNS FROM wecom_entities');
  const existing = new Set(columns.map(column => column.Field));
  if (mode === 'snapshot') {
    const selected = Object.keys(fields).filter(field => existing.has(field));
    const rows = await prisma.$queryRawUnsafe(`SELECT corpid${selected.map(field => `, ${field}`).join('')} FROM wecom_entities`);
    fs.writeFileSync(file, JSON.stringify(rows), { mode: 0o600 });
    console.log(`Preserved local fields for ${rows.length} entities`);
    return;
  }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Only fields absent from the production schema need local preservation.
  const missing = Object.keys(fields).filter(field => !existing.has(field));
  for (const field of missing) {
    await prisma.$executeRawUnsafe(`ALTER TABLE wecom_entities ADD COLUMN ${field} ${fields[field]}`);
  }
  for (const row of rows) {
    for (const field of missing) {
      if (row[field] == null) continue;
      const value = field === 'served_user_count' ? row[field] : new Date(row[field]);
      await prisma.$executeRawUnsafe(`UPDATE wecom_entities SET ${field} = ? WHERE corpid = ?`, value, row.corpid);
    }
  }
  console.log(`Restored ${missing.length} local-only columns`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
