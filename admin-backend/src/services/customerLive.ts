import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { ensureCustomerLiveSchema } from '../lib/customerLiveSchema';
import { fingerprintOf, jsonValue, liveState, lockLiveState, relationKey, sql, subtractLiveCount, touchLive, upsertCustomers } from '../lib/customerLiveStore';
import { readSnapshotMeta, snapshotRows } from '../lib/customerSnapshotStore';
import { getCustomerDetail, getCustomerIds, getCustomerPage } from './wecom';
import { retryCustomerRequest } from '../lib/resumableCustomers';
import { customerStorage, CustomerStorageError } from '../lib/customerStorageGuard';

const directory = path.resolve(process.env.CUSTOMER_SNAPSHOT_DIR || 'data/customer-snapshots');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const safeError = (e: unknown) => e instanceof Error && !('code' in e) ? e.message.slice(0, 240) : '增量同步失败，已保留数据并安排重试';
export const backoff = (failures: number) => Math.min(30 * 60 * 1000, 15000 * 2 ** Math.min(failures, 7));

export async function enqueueDetail(id: number, fp: string, externalId: string, userId: string, tx: any = prisma) {
  if (!externalId || !userId || externalId.length > 191 || userId.length > 191) throw new Error('客户或员工标识无效');
  const key = createHash('sha256').update(JSON.stringify([id, fp, externalId, userId])).digest('hex');
  await tx.$executeRaw(sql`INSERT INTO customer_live_tasks(task_key,entity_id,fingerprint,user_id,external_id,requested_ms)
    VALUES(${key},${id},${fp},${userId},${externalId},${Date.now()}) ON DUPLICATE KEY UPDATE requested_ms=GREATEST(requested_ms+1,VALUES(requested_ms))`);
}

class CustomerLive {
  enabled = false;
  private stopped = false;
  private workers: Promise<unknown>[] = [];
  private taskStreak = 0;
  private lastDiscovery = 0;
  private lastEntity = 0;

  async start() {
    if (process.env.CUSTOMER_LIVE_ENABLED !== 'true' || this.enabled) return;
    await ensureCustomerLiveSchema();
    this.enabled = true;
    this.workers = [this.importLoop(), this.workerLoop()];
  }
  async stop() { this.stopped = true; await Promise.allSettled(this.workers); }

  private async importLoop() {
    while (!this.stopped) {
      try {
        if (!await customerStorage.available()) { await pause(30000); continue; }
        const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' } });
        // Prioritize the reported entity, then make smaller entities available before the next large import.
        const sizes = new Map<number, number>();
        for (const entity of entities) sizes.set(entity.id, (await readSnapshotMeta(directory, entity.id))?.count || 0);
        entities.sort((a, b) => Number(b.id === 7) - Number(a.id === 7) || sizes.get(a.id)! - sizes.get(b.id)!);
        for (const entity of entities) {
          if (this.stopped) return;
          const fp = fingerprintOf(entity); const meta = await readSnapshotMeta(directory, entity.id);
          if (!meta || meta.fingerprint !== fp) continue;
          await prisma.$executeRaw(sql`INSERT IGNORE INTO customer_live_state(entity_id,fingerprint) VALUES(${entity.id},${fp})`);
          const state = await liveState(entity.id, fp);
          if (state.source_file === meta.file && state.ready) continue;
          const skip = state.source_file === meta.file ? Number(state.import_rows) : 0;
          if (state.source_file !== meta.file) await prisma.$executeRaw(sql`UPDATE customer_live_state SET source_file=${meta.file},import_rows=0 WHERE entity_id=${entity.id} AND fingerprint=${fp}`);
          let index = 0; let batch: any[] = [];
          const flush = async () => {
            if (!batch.length) return;
            await customerStorage.assertAvailable();
            await prisma.$transaction(async tx => {
              await upsertCustomers(entity.id, fp, batch, 0, meta.file, tx);
              await tx.$executeRaw(sql`UPDATE customer_live_state SET import_rows=${index},revision=revision+1 WHERE entity_id=${entity.id} AND fingerprint=${fp}`);
            }, { timeout: 30000 });
            batch = []; await pause(30);
          };
          for await (const row of snapshotRows(directory, meta)) {
            if (this.stopped) return;
            index++; if (index <= skip) continue;
            batch.push(row); if (batch.length >= 300) await flush();
          }
          await flush();
          if (index !== meta.count) throw new Error('基础快照条数不一致，仍保留原查询');
          await prisma.$transaction(async tx => {
            const previous = await tx.$queryRaw<any[]>(sql`SELECT meta,active_count FROM customer_live_state WHERE entity_id=${entity.id} AND fingerprint=${fp} FOR UPDATE`);
            const old = jsonValue(previous[0]?.meta);
            const mergedTags = new Map<string, string>(meta.tags.map(tag => [tag.id, tag.name]));
            for (const tag of old?.tags || []) if (tag.name || !mergedTags.has(tag.id)) mergedTags.set(tag.id, tag.name);
            const merged = { ...meta, users: [...new Set([...meta.users, ...(old?.users || [])])], sources: [...new Set([...meta.sources, ...(old?.sources || [])])], tags: [...mergedTags].map(([id, name]) => ({ id, name })) };
            let count = previous[0]?.active_count;
            if (count == null) count = (await tx.$queryRaw<any[]>(sql`SELECT COUNT(*) n FROM customer_live_relations FORCE INDEX (customer_added) WHERE entity_id=${entity.id} AND fingerprint=${fp} AND deleted=FALSE`))[0].n;
            await tx.$executeRaw(sql`UPDATE customer_live_state SET ready=TRUE,meta=${JSON.stringify(merged)},active_count=${count},error='',revision=revision+1 WHERE entity_id=${entity.id} AND fingerprint=${fp}`);
          }, { timeout: 120000 });
          const recent = await prisma.$queryRaw<any[]>(sql`SELECT user_id,MAX(added_at) recent FROM customer_live_relations WHERE entity_id=${entity.id} AND fingerprint=${fp} AND deleted=FALSE GROUP BY user_id`);
          const active = new Set(recent.filter(row => Number(row.recent) * 1000 > Date.now() - 7 * 86400000).map(row => row.user_id));
          for (const user of meta.users) await prisma.$executeRaw(sql`INSERT IGNORE INTO customer_live_employees(entity_id,fingerprint,user_id,full_ms,due_ms) VALUES(${entity.id},${fp},${user},${Date.parse(meta.updatedAt)},${active.has(user) ? 0 : Date.now() + 5 * 60000})`);
          console.log(`[CustomerLive] entity=${entity.id} baseline=${index}`);
        }
      } catch { console.error('[CustomerLive] baseline import failed; retrying from committed position'); }
      await pause(30000);
    }
  }

  private async workerLoop() {
    while (!this.stopped) {
      try {
        if (!await customerStorage.available()) { await pause(30000); continue; }
        await this.workOnce();
      }
      catch { console.error('[CustomerLive] worker failure; durable queue retained'); }
      await pause(700);
    }
  }

  private async discovery() {
    const entities = await prisma.wecomEntity.findMany({ where: { status: 'active' } });
    for (const entity of entities) {
      const fp = fingerprintOf(entity); if (!(await liveState(entity.id, fp))?.ready) continue;
      try {
        const result = await getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl);
        if (!result.users) continue;
        for (const user of result.users) await prisma.$executeRaw(sql`INSERT IGNORE INTO customer_live_employees(entity_id,fingerprint,user_id,full_ms) VALUES(${entity.id},${fp},${user},${Date.now()})`);
        await prisma.$transaction(async tx => {
          const states = await tx.$queryRaw<any[]>(sql`SELECT meta FROM customer_live_state WHERE entity_id=${entity.id} AND fingerprint=${fp} FOR UPDATE`);
          const meta = jsonValue(states[0].meta); meta.users = [...new Set([...meta.users, ...result.users!])];
          await tx.$executeRaw(sql`UPDATE customer_live_state SET meta=${JSON.stringify(meta)} WHERE entity_id=${entity.id} AND fingerprint=${fp}`);
        });
      } catch { /* Other entities and queued events must continue during an upstream outage. */ }
    }
  }

  private async workOnce() {
    if (Date.now() - this.lastDiscovery > 30 * 60 * 1000) {
      this.lastDiscovery = Date.now(); await this.discovery();
      await prisma.$executeRaw(sql`DELETE FROM customer_live_events WHERE received_ms<${Date.now() - 30 * 86400000} LIMIT 1000`);
    }
    const tasks = await prisma.$queryRaw<any[]>(sql`SELECT t.* FROM customer_live_tasks t
      JOIN customer_live_state s ON s.entity_id=t.entity_id AND s.fingerprint=t.fingerprint AND s.ready=TRUE
      WHERE t.due_ms<=${Date.now()} ORDER BY t.due_ms,t.requested_ms LIMIT 1`);
    if (tasks.length && this.taskStreak < 4) { this.taskStreak++; await this.detail(tasks[0]); return; }
    this.taskStreak = 0;
    const employees = await prisma.$queryRaw<any[]>(sql`SELECT e.* FROM customer_live_employees e
      JOIN customer_live_state s ON s.entity_id=e.entity_id AND s.fingerprint=e.fingerprint AND s.ready=TRUE
      WHERE e.due_ms<=${Date.now()} ORDER BY (e.entity_id>${this.lastEntity}) DESC,e.entity_id,e.due_ms,e.checked_ms LIMIT 1`);
    if (employees.length) { this.lastEntity = employees[0].entity_id; await this.employee(employees[0]); }
    else if (tasks.length) await this.detail(tasks[0]);
  }

  private async entity(id: number, fp: string) {
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    return entity?.status === 'active' && fingerprintOf(entity) === fp ? entity : null;
  }

  private async detail(task: any) {
    const id = task.entity_id; const fp = task.fingerprint;
    try {
      const entity = await this.entity(id, fp);
      if (!entity) { await prisma.$executeRaw(sql`DELETE FROM customer_live_tasks WHERE task_key=${task.task_key}`); return; }
      const observed = Date.now();
      const rows = await retryCustomerRequest(() => getCustomerDetail(entity, task.external_id), () => undefined);
      if (!await this.entity(id, fp)) return;
      const own = rows.filter(row => row.userId === task.user_id);
      await customerStorage.assertAvailable();
      await prisma.$transaction(async tx => {
        if (own.length) await upsertCustomers(id, fp, own, observed, '', tx);
        // Missing follow info is not proof of deletion (application visibility may have changed).
        else await tx.$executeRaw(sql`UPDATE customer_live_employees SET due_ms=0 WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${task.user_id}`);
        await touchLive(id, fp, tx);
        await tx.$executeRaw(sql`DELETE FROM customer_live_tasks WHERE task_key=${task.task_key} AND requested_ms=${task.requested_ms}`);
      });
    } catch (e) {
      if (e instanceof CustomerStorageError) throw e;
      await prisma.$executeRaw(sql`UPDATE customer_live_tasks SET failures=failures+1,error=${safeError(e)},due_ms=${Date.now() + backoff(task.failures)} WHERE task_key=${task.task_key}`);
      // A customer removed before processing needs an employee reconciliation, not endless detail retries.
      if (/错误码 (84061|40096)\b/.test(safeError(e))) await prisma.$executeRaw(sql`UPDATE customer_live_employees SET due_ms=0 WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${task.user_id}`);
    }
  }

  private async employee(employee: any) {
    const id = employee.entity_id; const fp = employee.fingerprint; const user = employee.user_id;
    try {
      const entity = await this.entity(id, fp);
      if (!entity) { await prisma.$executeRaw(sql`UPDATE customer_live_employees SET due_ms=${Date.now() + 86400000} WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`); return; }
      let scan = jsonValue(employee.scan);
      if (!scan) {
        const observed = Date.now();
        const ids = await retryCustomerRequest(() => getCustomerIds(entity, user), () => undefined);
        await customerStorage.assertAvailable();
        if (!await this.entity(id, fp)) return;
        const known = await prisma.$queryRaw<any[]>(sql`SELECT external_id,added_at FROM customer_live_relations WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user} AND deleted=FALSE`);
        const saved = new Set<string>(known.map(row => row.external_id)); const current = new Set(ids);
        const added = ids.filter(external => !saved.has(external));
        const removed = known.filter(row => !current.has(row.external_id));
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()));
        const nightly = hour >= 1 && hour < 6 && Date.now() - Number(employee.full_ms) > 86400000;
        if (added.length > Math.max(25, Math.ceil(ids.length / 100) * 2) || nightly) {
          scan = { cursor: '', generation: randomUUID(), started: observed, pages: 0 };
          await prisma.$executeRaw(sql`UPDATE customer_live_employees SET scan=${JSON.stringify(scan)} WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
        } else {
          await prisma.$transaction(async tx => {
            await lockLiveState(id, fp, tx);
            for (const external of added) await enqueueDetail(id, fp, external, user, tx);
            for (let i = 0; i < removed.length; i += 300) {
              const keys = removed.slice(i, i + 300).map(row => relationKey(row.external_id, user));
              const changed = await tx.$executeRaw(sql`UPDATE customer_live_relations SET deleted=TRUE,observed_ms=${observed} WHERE entity_id=${id} AND fingerprint=${fp} AND relation_key IN (${Prisma.join(keys)}) AND observed_ms<=${observed} AND deleted=FALSE`);
              await subtractLiveCount(id, fp, changed, tx);
            }
            // Remove obsolete pending detail work only after a successful current ID-list read.
            const pending = await tx.$queryRaw<any[]>(sql`SELECT task_key,external_id,requested_ms FROM customer_live_tasks WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
            for (const task of pending) if (!current.has(task.external_id)) await tx.$executeRaw(sql`DELETE FROM customer_live_tasks WHERE task_key=${task.task_key} AND requested_ms<=${observed}`);
            if (removed.length) await touchLive(id, fp, tx);
            const active = added.length > 0 || known.some(row => Number(row.added_at) * 1000 > Date.now() - 3 * 86400000);
            await tx.$executeRaw(sql`UPDATE customer_live_employees SET checked_ms=${Date.now()},due_ms=${Date.now() + (active ? 15 * 60000 : 6 * 3600000)},failures=0,error='' WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
          }, { timeout: 30000 });
          return;
        }
      }
      const observed = Date.now();
      const page = await retryCustomerRequest(() => getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl, user, scan.cursor), () => undefined);
      if (!page.items || page.nextCursor === undefined || page.items.some((row: any) => row.userId !== user)) throw new Error('客户分页数据不完整');
      if (page.nextCursor && page.nextCursor === scan.cursor) throw new Error('分页游标重复');
      if (!await this.entity(id, fp)) return;
      await customerStorage.assertAvailable();
      await prisma.$transaction(async tx => {
        await upsertCustomers(id, fp, page.items!, observed, scan.generation, tx);
        await touchLive(id, fp, tx);
        if (!page.nextCursor) {
          const changed = await tx.$executeRaw(sql`UPDATE customer_live_relations SET deleted=TRUE,observed_ms=${observed} WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user} AND generation<>${scan.generation} AND observed_ms<=${scan.started} AND deleted=FALSE`);
          await subtractLiveCount(id, fp, changed, tx);
          await tx.$executeRaw(sql`UPDATE customer_live_employees SET scan=NULL,checked_ms=${Date.now()},full_ms=${Date.now()},due_ms=${Date.now() + 15 * 60000},failures=0,error='' WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
        } else {
          scan.cursor = page.nextCursor; scan.pages++;
          await tx.$executeRaw(sql`UPDATE customer_live_employees SET scan=${JSON.stringify(scan)},due_ms=${Date.now()},failures=0,error='' WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
        }
      }, { timeout: 30000 });
    } catch (e) {
      if (e instanceof CustomerStorageError) throw e;
      // Invalid/expired cursor restarts only this employee; already ingested rows are idempotent.
      const expired = /游标/.test(safeError(e));
      await prisma.$executeRaw(sql`UPDATE customer_live_employees SET failures=failures+1,error=${safeError(e)},due_ms=${Date.now() + backoff(employee.failures)},scan=IF(${expired},NULL,scan) WHERE entity_id=${id} AND fingerprint=${fp} AND user_id=${user}`);
    }
  }

  async status(id: number, fp: string) {
    if (!this.enabled) return { enabled: false };
    const storageReady = await customerStorage.available();
    const state = await liveState(id, fp);
    const employees = await prisma.$queryRaw<any[]>(sql`SELECT COUNT(*) total,SUM(checked_ms>0) checked,SUM(failures>0) failed,MIN(NULLIF(checked_ms,0)) oldest,MAX(checked_ms) latest FROM customer_live_employees WHERE entity_id=${id} AND fingerprint=${fp}`);
    const tasks = await prisma.$queryRaw<any[]>(sql`SELECT COUNT(*) pending,SUM(failures>0) failed FROM customer_live_tasks WHERE entity_id=${id} AND fingerprint=${fp}`);
    const errors = await prisma.$queryRaw<any[]>(sql`SELECT error FROM customer_live_employees WHERE entity_id=${id} AND fingerprint=${fp} AND failures>0 LIMIT 1`);
    return { enabled: true, ready: !!state?.ready, importRows: Number(state?.import_rows || 0),
      incrementAt: Number(state?.increment_ms) || null, eventAt: Number(state?.event_ms) || null,
      revision: String(state?.revision || 0), employees: Number(employees[0].total), checked: Number(employees[0].checked || 0),
      failed: Number(employees[0].failed || 0) + Number(tasks[0].failed || 0), pending: Number(tasks[0].pending),
      oldestCheckAt: Number(employees[0].oldest) || null, latestCheckAt: Number(employees[0].latest) || null,
      paused: !storageReady, error: customerStorage.reason || errors[0]?.error || '' };
  }
}
export const customerLive = new CustomerLive();
