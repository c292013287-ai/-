import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import type { CustomerRow } from './customerSync';
import { snapshotRows, type SnapshotMeta } from './customerSnapshotStore';

export const fingerprintOf = (e: { corpid: string; secret: string; wecomApiBaseUrl: string | null }) =>
  createHash('sha256').update(JSON.stringify([e.corpid, e.secret, e.wecomApiBaseUrl])).digest('hex');
export const relationKey = (externalId: string, userId: string) => createHash('sha256').update(JSON.stringify([externalId, userId])).digest('hex');
export const jsonValue = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
export const sql = Prisma.sql;

export async function liveState(id: number, fp: string) {
  const rows = await prisma.$queryRaw<any[]>(sql`SELECT * FROM customer_live_state WHERE entity_id=${id} AND fingerprint=${fp}`);
  return rows[0];
}

export async function lockLiveState(id: number, fp: string, tx: any) {
  const rows = await tx.$queryRaw(sql`SELECT active_count FROM customer_live_state WHERE entity_id=${id} AND fingerprint=${fp} FOR UPDATE`);
  if (!rows.length) throw new Error('增量基础状态尚未建立');
  return rows[0];
}

async function ensureLiveCount(id: number, fp: string) {
  const state = await liveState(id, fp);
  if (!state?.ready || state.active_count != null) return;
  await prisma.$transaction(async tx => {
    const current = await lockLiveState(id, fp, tx);
    if (current.active_count != null) return;
    const rows = await tx.$queryRaw<any[]>(sql`SELECT COUNT(*) n FROM customer_live_relations FORCE INDEX (customer_added) WHERE entity_id=${id} AND fingerprint=${fp} AND deleted=FALSE`);
    await tx.$executeRaw(sql`UPDATE customer_live_state SET active_count=${rows[0].n} WHERE entity_id=${id} AND fingerprint=${fp}`);
  }, { timeout: 120000 });
}

export async function subtractLiveCount(id: number, fp: string, removed: number, tx: any) {
  if (removed) await tx.$executeRaw(sql`UPDATE customer_live_state SET active_count=active_count-${removed} WHERE entity_id=${id} AND fingerprint=${fp}`);
}

export async function upsertCustomers(id: number, fp: string, items: CustomerRow[], observed: number, generation = '', tx: any = prisma): Promise<void> {
  if (!items.length) return;
  if (tx === prisma) return prisma.$transaction(inner => upsertCustomers(id, fp, items, observed, generation, inner));
  for (const row of items) if (!row.userId || !row.externalUserId || row.userId.length > 191 || row.externalUserId.length > 191) throw new Error('客户或员工标识无效');
  await lockLiveState(id, fp, tx);
  const keys = [...new Set(items.map(row => relationKey(row.externalUserId, row.userId)))];
  const previous = await tx.$queryRaw(sql`SELECT relation_key,deleted,observed_ms FROM customer_live_relations WHERE entity_id=${id} AND fingerprint=${fp} AND relation_key IN (${Prisma.join(keys)}) FOR UPDATE`);
  const old = new Map<string, any>(previous.map((row: any) => [row.relation_key, row]));
  const added = keys.filter(key => !old.has(key) || old.get(key).deleted && observed >= Number(old.get(key).observed_ms)).length;
  const values = items.map(row => sql`(${id},${fp},${relationKey(row.externalUserId, row.userId)},${row.userId},${row.externalUserId},${row.addedAt ?? null},FALSE,${observed},${generation},${JSON.stringify(row)})`);
  // Apply only observations at least as new as the stored one. Baseline imports use 0.
  await tx.$executeRaw(sql`INSERT INTO customer_live_relations
    (entity_id,fingerprint,relation_key,user_id,external_id,added_at,deleted,observed_ms,generation,payload)
    VALUES ${Prisma.join(values)} ON DUPLICATE KEY UPDATE
    added_at=IF(VALUES(observed_ms)>=observed_ms,VALUES(added_at),added_at),
    payload=IF(VALUES(observed_ms)>=observed_ms,VALUES(payload),payload),
    deleted=IF(VALUES(observed_ms)>=observed_ms,FALSE,deleted),
    generation=IF(VALUES(observed_ms)>=observed_ms,VALUES(generation),generation),
    observed_ms=GREATEST(observed_ms,VALUES(observed_ms))`);
  if (added) await tx.$executeRaw(sql`UPDATE customer_live_state SET active_count=active_count+${added} WHERE entity_id=${id} AND fingerprint=${fp}`);
  if (observed > 0) {
    const states = await tx.$queryRaw(sql`SELECT meta FROM customer_live_state WHERE entity_id=${id} AND fingerprint=${fp} FOR UPDATE`);
    const meta = jsonValue(states[0]?.meta);
    if (meta) {
      const tags = new Map<string, string>(meta.tags.map((tag: any) => [tag.id, tag.name]));
      const users = new Set<string>(meta.users); const sources = new Set<number>(meta.sources);
      let changed = false;
      for (const row of items as any[]) {
        if (!users.has(row.userId)) { users.add(row.userId); changed = true; }
        if (row.addWay != null && !sources.has(row.addWay)) { sources.add(row.addWay); changed = true; }
        for (const tag of row.tags || []) if (!tags.has(tag.id) || tag.name && tag.name !== tags.get(tag.id)) { tags.set(tag.id, tag.name); changed = true; }
      }
      if (changed) await tx.$executeRaw(sql`UPDATE customer_live_state SET meta=${JSON.stringify({ ...meta, users: [...users], sources: [...sources], tags: [...tags].map(([id, name]) => ({ id, name })) })} WHERE entity_id=${id} AND fingerprint=${fp}`);
    }
  }
}

export async function touchLive(id: number, fp: string, tx: any = prisma) {
  await tx.$executeRaw(sql`UPDATE customer_live_state SET increment_ms=${Date.now()},revision=revision+1 WHERE entity_id=${id} AND fingerprint=${fp}`);
}

export function liveFilter(id: number, fp: string, f: Record<string, any>) {
  const parts = [sql`entity_id=${id}`, sql`fingerprint=${fp}`, sql`deleted=FALSE`];
  const fields: Record<string, string> = { name: '$.name', remark: '$.remark', externalUserId: '$.externalUserId', unionId: '$.unionId', state: '$.state' };
  for (const [key, path] of Object.entries(fields)) if (f[key]?.trim()) parts.push(sql`LOCATE(${String(f[key]).trim().toLowerCase()},LOWER(JSON_UNQUOTE(JSON_EXTRACT(payload,${path}))))>0`);
  if (f.userId) parts.push(sql`user_id=${f.userId}`);
  for (const key of ['gender', 'type', 'addWay']) if (f[key] !== undefined) parts.push(sql`JSON_EXTRACT(payload,${`$.${key}`})=${Number(f[key])}`);
  if (f.phone?.trim()) parts.push(sql`JSON_SEARCH(payload,'one',${'%' + String(f.phone).trim().replace(/[!%_]/g, '!$&') + '%'},'!','$.remarkMobiles[*]') IS NOT NULL`);
  if (f.tagId) parts.push(sql`JSON_CONTAINS(JSON_EXTRACT(payload,'$.tags'),${JSON.stringify({ id: f.tagId })})`);
  if (f.unionStatus === 'present') parts.push(sql`COALESCE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.unionId'))),'')<>''`);
  if (f.unionStatus === 'missing') parts.push(sql`COALESCE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.unionId'))),'')=''`);
  if (f.startDate) parts.push(sql`added_at>=${Date.parse(`${f.startDate}T00:00:00+08:00`) / 1000}`);
  if (f.endDate) parts.push(sql`added_at<${Date.parse(`${f.endDate}T00:00:00+08:00`) / 1000 + 86400}`);
  return Prisma.join(parts, ' AND ');
}

export async function readLivePage(id: number, fp: string, filters: Record<string, any>, page: number, pageSize: number) {
  await ensureLiveCount(id, fp);
  return prisma.$transaction(async tx => {
    const states = await tx.$queryRaw<any[]>(sql`SELECT * FROM customer_live_state WHERE entity_id=${id} AND fingerprint=${fp}`);
    const state = states[0]; if (!state?.ready) return null;
    const meta = jsonValue(state.meta) as SnapshotMeta;
    const where = liveFilter(id, fp, filters);
    // This exact count is committed atomically with relationship inserts/restores/deletions.
    const counts = [{ n: state.active_count }];
    const filtered = Object.values(filters).some(value => value !== undefined && value !== '');
    const totals = filtered ? await tx.$queryRaw<any[]>(sql`SELECT COUNT(*) n FROM customer_live_relations WHERE ${where}`) : counts;
    const rows = await tx.$queryRaw<any[]>(sql`SELECT payload FROM customer_live_relations WHERE ${where} ORDER BY added_at DESC,relation_key DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    return { items: rows.map(row => jsonValue(row.payload)), total: Number(totals[0].n), count: Number(counts[0].n),
      page, pageSize, users: meta.users, tags: meta.tags, sources: meta.sources, warning: meta.warning,
      updatedAt: Number(state.increment_ms) ? new Date(Number(state.increment_ms)).toISOString() : meta.updatedAt,
      revision: String(state.revision), fullUpdatedAt: meta.updatedAt, mode: 'incremental' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function* exportLive(id: number, fp: string, filters: Record<string, any>, signal?: AbortSignal) {
  const directory = await mkdtemp(path.join(tmpdir(), 'customer-export-'));
  const file = 'rows.ndjson'; const handle = await open(path.join(directory, file), 'wx', 0o600);
  try {
    // Spool one consistent MVCC read before sending rows; live updates cannot shift export pages.
    await prisma.$transaction(async tx => {
      let last = '';
      while (true) {
        signal?.throwIfAborted();
        const rows = await tx.$queryRaw<any[]>(sql`SELECT relation_key,payload FROM customer_live_relations WHERE ${liveFilter(id, fp, filters)} AND relation_key>${last} ORDER BY relation_key LIMIT 500`);
        if (!rows.length) break;
        await handle.writeFile(rows.map(row => JSON.stringify(jsonValue(row.payload))).join('\n') + '\n');
        last = rows[rows.length - 1].relation_key;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300000 });
    await handle.close();
    yield* snapshotRows(directory, { file } as SnapshotMeta, signal);
  } finally { await handle.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
}
