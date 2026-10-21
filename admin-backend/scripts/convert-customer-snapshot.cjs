// Run separately from the web process, once per existing complete legacy snapshot.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSnapshotWriter, readSnapshotMeta } = require('../dist/lib/customerSnapshotStore');
(async () => {
  const directory = path.resolve(process.env.CUSTOMER_SNAPSHOT_DIR || 'data/customer-snapshots');
  const id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid entity id');
  if (await readSnapshotMeta(directory, id)) { console.log(JSON.stringify({ id, skipped: true })); return; }
  const saved = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
  const writer = await createSnapshotWriter(directory, id);
  try {
    for (let index = 0; index < saved.snapshot.items.length; index += 100) await writer.append(saved.snapshot.items.slice(index, index + 100));
    const meta = await writer.commit({ fingerprint: saved.fingerprint, users: saved.snapshot.users, warning: saved.snapshot.warning, updatedAt: saved.snapshot.updatedAt });
    console.log(JSON.stringify({ id, count: meta.count }));
  } catch (error) { await writer.abort(); throw error; }
})().catch(() => { console.error('Snapshot conversion failed; original preserved'); process.exitCode = 1; });
