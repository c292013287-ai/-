require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const prisma = require('../dist/lib/prisma').default;
const { ensureCustomerLiveSchema } = require('../dist/lib/customerLiveSchema');

(async () => {
  await ensureCustomerLiveSchema();
  const filename = process.env.CUSTOMER_CALLBACK_CONFIG || path.resolve('data/customer-callbacks.json');
  let config = {};
  try { config = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' }, select: { id: true } });
  for (const { id } of entities) if (!config[id]) config[id] = { token: randomBytes(24).toString('hex'), aesKey: randomBytes(32).toString('base64').slice(0, -1) };
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = filename + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
  await fs.rename(temporary, filename); await fs.chmod(filename, 0o600);
  console.log(JSON.stringify({ tablesReady: true, callbackCredentialsPrepared: entities.length, configurationFile: filename }));
})().catch(() => { console.error('Customer live preparation failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
