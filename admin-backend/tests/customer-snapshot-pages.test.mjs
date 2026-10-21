import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSnapshotWriter, readSnapshotMeta, readSnapshotPage, snapshotRows, matchesSnapshotCustomer, csvCell } from '../src/lib/customerSnapshotStore.ts';
import { collectCustomerSnapshot } from '../src/lib/customerSync.ts';

test('bounded pages, all-record filtering, immutable published snapshot and aborted staging', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customer-pages-'));
  try {
    const writer = await createSnapshotWriter(directory, 1);
    const result = await collectCustomerSnapshot(['a'], async (_, cursor) => {
      const page = Number(cursor || 0);
      return { items: Array.from({ length: 100 }, (_, index) => ({ externalUserId: `${page}-${index}`, userId: 'a', name: index % 2 ? 'match' : 'other', gender: 0, addWay: 0, tags: [{ id: 'one', name: '标签' }] })), nextCursor: page < 99 ? String(page + 1) : '' };
    }, () => {}, undefined, items => writer.append(items));
    assert.equal(result.items.length, 0, 'streamed mode retains no full records');
    assert.equal(await readSnapshotMeta(directory, 1), null);
    const meta = await writer.commit({ fingerprint: 'test', users: ['a'], warning: '', updatedAt: 'now' });
    assert.equal(meta.count, 10000);
    assert.equal((await readSnapshotPage(directory, meta, {}, 1, 20)).items.length, 20);
    const filtered = await readSnapshotPage(directory, meta, { name: 'match', gender: '0', addWay: '0' }, 2, 20);
    assert.equal(filtered.total, 5000);
    assert.equal(filtered.items[0].externalUserId, '0-41');
    let exported = 0;
    for await (const row of snapshotRows(directory, meta)) if (matchesSnapshotCustomer(row, { name: 'match' })) exported++;
    assert.equal(exported, 5000);
    const incomplete = await createSnapshotWriter(directory, 1);
    await incomplete.append([{ externalUserId: 'partial', userId: 'a' }]); await incomplete.abort();
    assert.deepEqual(await readSnapshotMeta(directory, 1), meta);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readSnapshotPage(directory, meta, {}, 1, 20, controller.signal));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CSV quoting neutralizes formulas and preserves long identifiers', () => {
  assert.equal(csvCell('=1+2'), '"\'=1+2"');
  assert.equal(csvCell('001234567890'), '"\'001234567890"');
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
});
