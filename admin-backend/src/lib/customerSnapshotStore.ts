import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SnapshotMeta {
  fingerprint: string; file: string; users: string[]; warning: string; updatedAt: string;
  count: number; tags: Array<{ id: string; name: string }>; sources: number[];
}
export async function createSnapshotWriter(directory: string, id: number, resume?: { file: string; bytes: number }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = resume?.file || `${id}-${randomUUID()}.ndjson`;
  if (path.basename(file) !== file) throw new Error('快照文件名无效');
  const handle = await open(path.join(directory, file), resume ? 'r+' : 'wx', 0o600);
  if (resume) {
    if ((await handle.stat()).size < resume.bytes) { await handle.close(); throw new Error('断点数据不完整，不能继续'); }
    await handle.truncate(resume.bytes);
  }
  let bytes = resume?.bytes || 0;
  let closed = false;
  let count = 0;
  const tags = new Map<string, string>();
  const sources = new Set<number>();
  const record = (item: any) => {
    count++;
    for (const tag of item.tags || []) tags.set(tag.id, tag.name || tag.id);
    if (item.addWay != null) sources.add(item.addWay);
  };
  if (resume) {
    try { for await (const item of snapshotRows(directory, { file } as SnapshotMeta)) record(item); }
    catch (e) { await handle.close(); throw e; }
  }
  return {
    file,
    async checkpoint() { await handle.sync(); return bytes; },
    async pause() { if (!closed) { await handle.close(); closed = true; } },
    async append(items: any[]) {
      if (!items.length) return;
      const buffer = Buffer.from(items.map(item => JSON.stringify(item)).join('\n') + '\n');
      let offset = 0;
      while (offset < buffer.length) {
        const result = await handle.write(buffer, offset, buffer.length - offset, bytes + offset);
        if (!result.bytesWritten) throw new Error('写入同步数据失败');
        offset += result.bytesWritten;
      }
      bytes += buffer.length;
      for (const item of items) record(item);
    },
    async commit(meta: Omit<SnapshotMeta, 'file' | 'count' | 'tags' | 'sources'>) {
      await handle.sync(); await handle.close(); closed = true;
      const value: SnapshotMeta = { ...meta, file, count, tags: [...tags].map(([id, name]) => ({ id, name })), sources: [...sources] };
      const target = path.join(directory, `${id}.meta.json`);
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await rename(temp, target);
      return value;
    },
    async abort() {
      if (!closed) await handle.close();
      await unlink(path.join(directory, file)).catch(() => undefined);
    },
  };
}

export async function readSnapshotMeta(directory: string, id: number): Promise<SnapshotMeta | null> {
  try { return JSON.parse(await readFile(path.join(directory, `${id}.meta.json`), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}

export async function* snapshotRows(directory: string, meta: SnapshotMeta, signal?: AbortSignal) {
  const input = createReadStream(path.join(directory, path.basename(meta.file)), { encoding: 'utf8', signal });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) { signal?.throwIfAborted(); if (line) yield JSON.parse(line); } }
  finally { lines.close(); input.destroy(); }
}

export function matchesSnapshotCustomer(item: any, filters: Record<string, any>) {
  const includes = (value: unknown, query: unknown) => !query || String(value ?? '').toLocaleLowerCase().includes(String(query).trim().toLocaleLowerCase());
  for (const key of ['name', 'remark', 'externalUserId', 'unionId', 'state']) if (!includes(item[key], filters[key])) return false;
  if (filters.userId && filters.userId !== item.userId) return false;
  if (filters.phone && !(item.remarkMobiles || []).some((phone: string) => includes(phone, filters.phone))) return false;
  for (const key of ['gender', 'type', 'addWay']) {
    if (filters[key] !== undefined && Number(filters[key]) !== (key === 'gender' ? item[key] ?? 0 : item[key])) return false;
  }
  if (filters.tagId && !(item.tags || []).some((tag: any) => tag.id === filters.tagId)) return false;
  if (filters.unionStatus === 'present' && !item.unionId?.trim() || filters.unionStatus === 'missing' && item.unionId?.trim()) return false;
  if (filters.startDate || filters.endDate) {
    if (item.addedAt == null) return false;
    if (filters.startDate && item.addedAt * 1000 < Date.parse(`${filters.startDate}T00:00:00+08:00`)) return false;
    if (filters.endDate && item.addedAt * 1000 >= Date.parse(`${filters.endDate}T00:00:00+08:00`) + 86400000) return false;
  }
  return true;
}

export async function readSnapshotPage(directory: string, meta: SnapshotMeta, filters: Record<string, any>, page: number, pageSize: number, signal?: AbortSignal) {
  const items = []; let total = 0;
  const filtered = Object.values(filters).some(value => value !== undefined && value !== '');
  for await (const item of snapshotRows(directory, meta, signal)) {
    if (!matchesSnapshotCustomer(item, filters)) continue;
    if (total >= (page - 1) * pageSize && items.length < pageSize) items.push(item);
    total++;
    if (!filtered && items.length === pageSize) { total = meta.count; break; }
  }
  return { items, total: filtered ? total : meta.count, page, pageSize, users: meta.users, warning: meta.warning, updatedAt: meta.updatedAt, count: meta.count, tags: meta.tags, sources: meta.sources };
}

export const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r\n]/.test(text) || /^\d{10,}$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
