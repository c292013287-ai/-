import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import prisma from '../lib/prisma';
import { CustomerProgress } from '../lib/customerSync';
import { resumeCustomers, retryCustomerRequest } from '../lib/resumableCustomers';
import { getCustomerPage } from './wecom';
import { readSnapshotMeta, readSnapshotPage, snapshotRows, matchesSnapshotCustomer } from '../lib/customerSnapshotStore';
import { customerLive } from './customerLive';
import { exportLive, liveState, readLivePage, touchLive, upsertCustomers } from '../lib/customerLiveStore';
import { customerStorage } from '../lib/customerStorageGuard';

interface Job extends CustomerProgress {
  entityId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  updatedAt?: string;
  message?: string;
}
const directory = path.resolve(process.env.CUSTOMER_SNAPSHOT_DIR || 'data/customer-snapshots');
const identity = (entity: { corpid: string; secret: string; wecomApiBaseUrl: string | null }) =>
  createHash('sha256').update(JSON.stringify([entity.corpid, entity.secret, entity.wecomApiBaseUrl])).digest('hex');

// Restrictive permissions and same-filesystem rename keep incomplete snapshots invisible.
async function atomicWrite(file: string, value: unknown) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
}

class CustomerSyncJobs {
  private jobs = new Map<number, Job>();
  private active = 0;
  private persistQueue = Promise.resolve();
  private lastPersist = 0;
  private interrupted: number[] = [];
  private ready = this.restore();

  private async restore() {
    try {
      const jobs = JSON.parse(await readFile(path.join(directory, 'jobs.json'), 'utf8')) as Job[];
      for (const job of jobs) {
        if (job.status === 'running' || job.status === 'queued') {
          this.interrupted.push(job.entityId);
          job.status = 'failed'; job.error = '服务重启中断了同步，点击重试将从已保存断点继续';
          job.finishedAt = new Date().toISOString();
        }
        this.jobs.set(job.entityId, job);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('客户同步进度恢复失败');
    }
  }
  private persist(force = false) {
    if (!force && Date.now() - this.lastPersist < 3000) return;
    this.lastPersist = Date.now();
    const jobs = this.list();
    this.persistQueue = this.persistQueue.then(() => atomicWrite(path.join(directory, 'jobs.json'), jobs))
      .catch(() => { console.error('客户同步进度保存失败'); });
  }
  list() { return [...this.jobs.values()].map(job => ({ ...job })); }
  async status() { await this.ready; return this.list(); }
  async resumeInterrupted() { await this.ready; if (this.interrupted.length) await this.start(this.interrupted.splice(0)); }
  async start(ids: number[]) {
    await this.ready;
    for (const entityId of ids) {
      if (['queued', 'running'].includes(this.jobs.get(entityId)?.status || '')) continue;
      const previous = this.jobs.get(entityId);
      this.jobs.set(entityId, { entityId, status: 'queued', startedAt: new Date().toISOString(), employees: previous?.status === 'failed' ? previous.employees : 0, totalEmployees: previous?.totalEmployees || 0, pages: previous?.status === 'failed' ? previous.pages : 0, records: previous?.status === 'failed' ? previous.records : 0 });
    }
    this.persist(true); this.drain();
    return this.list();
  }
  private drain() {
    for (const job of this.jobs.values()) {
      if (this.active >= 1) break;
      if (job.status !== 'queued') continue;
      this.active++; job.status = 'running';
      void this.execute(job);
    }
  }
  private async execute(job: Job) {
    try {
      await customerStorage.assertAvailable();
      const entity = await prisma.wecomEntity.findUnique({ where: { id: job.entityId } });
      if (!entity || entity.status !== 'active') throw new Error('主体不存在或已停用');
      const fingerprint = identity(entity);
      const waiting = (attempt: number, seconds: number) => { job.message = `企业微信暂时繁忙或连接异常，${seconds}秒后自动重试（${attempt}/3）`; this.persist(true); };
      const snapshot = await resumeCustomers({ directory, id: job.entityId, fingerprint,
        followers: () => retryCustomerRequest(async () => {
          const result = await getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl);
          if (!result.users) throw new Error('成员列表不完整');
          return result.users;
        }, waiting),
        fetchPage: (user, cursor) => retryCustomerRequest(async () => {
          await customerStorage.assertAvailable();
          const observed = Date.now();
          const result = await getCustomerPage(entity.corpid, entity.secret, entity.wecomApiBaseUrl, user, cursor);
          if (!result.items || result.nextCursor === undefined) throw new Error('客户分页数据不完整');
          await customerStorage.assertAvailable();
          if (customerLive.enabled && (await liveState(job.entityId, fingerprint))?.ready) {
            await prisma.$transaction(async tx => {
              await upsertCustomers(job.entityId, fingerprint, result.items!, observed, '', tx);
              await touchLive(job.entityId, fingerprint, tx);
            });
          }
          return { items: result.items, nextCursor: result.nextCursor, tagWarning: result.tagWarning };
        }, waiting),
        progress: value => { Object.assign(job, value); job.message = '断点已保存'; this.persist(); },
        validate: async () => {
          const current = await prisma.wecomEntity.findUnique({ where: { id: job.entityId } });
          if (!current || current.status !== 'active' || identity(current) !== fingerprint) throw new Error('主体配置已变化，请重新同步');
        },
      });
      job.status = 'completed'; job.updatedAt = snapshot.updatedAt;
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error && !('code' in e) ? e.message : '同步失败，请重试；旧数据已保留';
    } finally {
      job.message = undefined;
      job.finishedAt = new Date().toISOString(); this.active--; this.persist(true); this.drain();
    }
  }
  private async metadata(id: number) {
    const entity = await prisma.wecomEntity.findUnique({ where: { id } });
    if (!entity) throw new Error('主体不存在');
    try {
      const saved = await readSnapshotMeta(directory, id);
      return saved?.fingerprint === identity(entity) ? saved : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('读取服务器快照失败');
    }
  }
  async snapshot(id: number, filters: Record<string, any> = {}, page = 1, pageSize = 20, signal?: AbortSignal) {
    const meta = await this.metadata(id);
    if (meta && customerLive.enabled) {
      const live = await readLivePage(id, meta.fingerprint, filters, page, pageSize);
      if (live) return live;
    }
    return meta ? readSnapshotPage(directory, meta, filters, page, pageSize, signal) : null;
  }
  async exportRows(id: number, filters: Record<string, any>, signal?: AbortSignal) {
    const meta = await this.metadata(id);
    if (!meta) throw new Error('没有完整同步数据');
    if (customerLive.enabled && (await liveState(id, meta.fingerprint))?.ready) return exportLive(id, meta.fingerprint, filters, signal);
    async function* rows() {
      for await (const item of snapshotRows(directory, meta!, signal)) if (matchesSnapshotCustomer(item, filters)) yield item;
    }
    return rows();
  }
}
export const customerSyncJobs = new CustomerSyncJobs();
