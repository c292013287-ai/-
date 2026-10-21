import { readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSnapshotWriter, readSnapshotMeta, snapshotRows, SnapshotMeta } from './customerSnapshotStore';
import { CustomerRow, CustomerProgress } from './customerSync';

interface Checkpoint {
  fingerprint: string; users: string[]; index: number; cursor: string; pages: number;
  records: number; file: string; bytes: number; warnings: string[];
}

export async function resumeCustomers(options: {
  directory: string; id: number; fingerprint: string;
  followers: () => Promise<string[]>;
  fetchPage: (user: string, cursor: string) => Promise<{ items: CustomerRow[]; nextCursor: string; tagWarning?: string }>;
  progress: (value: CustomerProgress) => void;
  validate: () => Promise<void>;
}) {
  const { directory, id, fingerprint } = options;
  const checkpointFile = path.join(directory, `${id}.checkpoint.json`);
  let saved: Checkpoint | undefined;
  try { saved = JSON.parse(await readFile(checkpointFile, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('读取同步断点失败'); }
  if (saved?.fingerprint !== fingerprint) saved = undefined;
  // A crash after publishing but before checkpoint cleanup must never truncate the published file.
  const published = await readSnapshotMeta(directory, id);
  if (saved && published?.file === saved.file) {
    await unlink(checkpointFile);
    return { updatedAt: published.updatedAt };
  }
  const users = saved?.users || [...new Set(await options.followers())];
  const writer = await createSnapshotWriter(directory, id, saved);
  let state: Checkpoint = saved || { fingerprint, users, index: 0, cursor: '', pages: 0, records: 0, file: writer.file, bytes: 0, warnings: [] };
  const persist = async () => {
    state.bytes = await writer.checkpoint();
    const temp = `${checkpointFile}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, checkpointFile);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  };
  const report = () => options.progress({ employees: state.index, totalEmployees: users.length, pages: state.pages, records: state.records });
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  try {
    await persist(); report();
    let ids = new Set<string>();
    if (saved && state.cursor) {
      for await (const item of snapshotRows(directory, { file: writer.file } as SnapshotMeta)) {
        if (item.userId === users[state.index]) ids.add(item.externalUserId);
      }
    }
    let cursors = new Set<string>();
    if (state.cursor) cursors.add(state.cursor);
    while (state.index < users.length) {
      if (Date.now() >= deadline) throw new Error('本轮同步已达三小时，断点已保存，点击重试继续');
      const user = users[state.index];
      const page = await options.fetchPage(user, state.cursor);
      if (page.nextCursor && cursors.has(page.nextCursor)) throw new Error('分页游标重复，断点已保留');
      const fresh: CustomerRow[] = [];
      for (const item of page.items) {
        if (!item.externalUserId || item.userId !== user) throw new Error('客户标识或员工ID不完整');
        if (!ids.has(item.externalUserId)) { ids.add(item.externalUserId); fresh.push(item); }
      }
      await writer.append(fresh);
      state = { ...state, pages: state.pages + 1, records: state.records + fresh.length, cursor: page.nextCursor };
      if (page.tagWarning && !state.warnings.includes(page.tagWarning)) state.warnings.push(page.tagWarning);
      if (!state.cursor) { state.index++; ids = new Set(); cursors = new Set(); }
      else cursors.add(state.cursor);
      await persist(); report();
    }
    await options.validate();
    const updatedAt = new Date().toISOString();
    await writer.commit({ fingerprint, users, warning: state.warnings.join('；'), updatedAt });
    await unlink(checkpointFile).catch(() => undefined);
    return { updatedAt };
  } finally { await writer.pause(); }
}

export async function retryCustomerRequest<T>(request: () => Promise<T>, waiting: (attempt: number, seconds: number) => void,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await request(); }
    catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (attempt >= 3 || !/系统繁忙|错误码 -1(?:\D|$)|连接失败|45009/.test(message)) throw e;
      const seconds = [5, 15, 45][attempt];
      waiting(attempt + 1, seconds); await sleep(seconds * 1000);
    }
  }
}
