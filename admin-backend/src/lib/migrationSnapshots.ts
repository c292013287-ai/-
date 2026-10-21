import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface MigrationSource { appToken: string; tableId: string; viewId: string }
export interface MigrationSourceRecord { recordId: string; createdTime?: number; fields: Record<string, string> }
interface SavedSource {
  source: MigrationSource;
  fingerprint: string;
  records: MigrationSourceRecord[] | null;
  revision: string;
  updatedAt: string | null;
}
interface Entry extends SavedSource {
  dueAt: number;
  running: boolean;
  error: string;
  generation: number;
  invalidated: boolean;
}
interface Options {
  directory: () => string;
  fingerprint: () => string;
  load: (source: MigrationSource) => Promise<MigrationSourceRecord[]>;
  intervalMs?: number;
  now?: () => number;
}

export class MigrationSnapshots {
  private entries = new Map<string, Entry>();
  private restoring?: Promise<void>;
  private registrations = new Map<string, Promise<Entry>>();
  private active = false;
  private timer?: ReturnType<typeof setInterval>;
  private interval: number;
  private now: () => number;

  constructor(private options: Options) {
    this.interval = options.intervalMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }
  private key(source: MigrationSource, fingerprint = this.options.fingerprint()) {
    return createHash('sha256').update(JSON.stringify([fingerprint, source.appToken, source.tableId, source.viewId])).digest('hex');
  }
  private async persist(key: string, value: SavedSource) {
    const directory = this.options.directory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${key}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ source: value.source, fingerprint: value.fingerprint,
        records: value.records, revision: value.revision, updatedAt: value.updatedAt }), { mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  private ready() {
    return this.restoring ??= (async () => {
      let files: string[];
      try { files = await readdir(this.options.directory()); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      for (const file of files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
        try {
          const saved = JSON.parse(await readFile(path.join(this.options.directory(), file), 'utf8')) as SavedSource;
          if (!saved.source?.appToken || !saved.source?.tableId || typeof saved.source.viewId !== 'string'
            || saved.fingerprint !== this.options.fingerprint() || `${this.key(saved.source)}.json` !== file) continue;
          if (saved.records !== null && (!Array.isArray(saved.records) || !saved.updatedAt || !saved.revision
            || saved.records.some(row => !row?.recordId || !row.fields))) continue;
          if (this.entries.size >= 20) break;
          this.entries.set(file.slice(0, -5), { ...saved, dueAt: 0, running: false, error: '', generation: 0, invalidated: false });
        } catch { console.error('[MigrationSync] Saved source could not be read; other sources remain available'); }
      }
    })();
  }
  async start() {
    await this.ready();
    if (!this.timer) {
      this.timer = setInterval(() => { void this.tick(); }, 2000);
      this.timer.unref();
    }
    void this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async register(source: MigrationSource): Promise<Entry> {
    await this.ready();
    const key = this.key(source);
    const existing = this.entries.get(key);
    if (existing) return existing;
    let registration = this.registrations.get(key);
    if (!registration) {
      registration = (async () => {
        if (this.entries.size + this.registrations.size >= 20) throw new Error('已达到源表同步数量上限');
        const entry: Entry = { source, fingerprint: this.options.fingerprint(), records: null, revision: '', updatedAt: null,
          running: false, dueAt: 0, error: '', generation: 0, invalidated: false };
        await this.persist(key, entry);
        this.entries.set(key, entry);
        return entry;
      })().finally(() => this.registrations.delete(key));
      this.registrations.set(key, registration);
    }
    return registration;
  }
  async read(source: MigrationSource, knownRevision = '', force = false) {
    const entry = await this.register(source);
    if (force) entry.dueAt = 0;
    void this.tick();
    const ready = entry.records !== null && !entry.invalidated;
    return {
      ready,
      records: ready && entry.revision !== knownRevision ? entry.records : undefined,
      revision: entry.revision, updatedAt: entry.updatedAt,
      refreshing: entry.running || entry.dueAt <= this.now(), error: entry.error,
      intervalSeconds: this.interval / 1000,
    };
  }
  invalidate(appToken: string, tableId: string) {
    for (const entry of this.entries.values()) {
      if (entry.source.appToken === appToken && entry.source.tableId === tableId) {
        entry.generation++;
        entry.invalidated = true;
        entry.dueAt = 0;
      }
    }
    void this.tick();
  }
  async tick() {
    try { await this.ready(); }
    catch { console.error('[MigrationSync] Source configuration unavailable'); return; }
    if (this.active) return;
    const target = [...this.entries.entries()].filter(([, value]) => value.dueAt <= this.now()
      && value.fingerprint === this.options.fingerprint()).sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
    if (!target) return;
    const [key, entry] = target;
    this.active = true;
    entry.running = true;
    const generation = entry.generation;
    try {
      const records = await this.options.load(entry.source);
      if (!Array.isArray(records) || records.some(row => !row?.recordId || !row.fields)) {
        throw new Error('源表同步结果不完整，请重试');
      }
      if (generation !== entry.generation || entry.fingerprint !== this.options.fingerprint()) return;
      const revision = createHash('sha256').update(JSON.stringify(records)).digest('hex');
      const saved: SavedSource = { source: entry.source, fingerprint: entry.fingerprint, records, revision,
        updatedAt: new Date(this.now()).toISOString() };
      // Only a complete, durably written source read becomes visible to browsers.
      await this.persist(key, saved);
      if (generation !== entry.generation || entry.fingerprint !== this.options.fingerprint()) return;
      Object.assign(entry, saved, { error: '', invalidated: false });
    } catch (error) {
      entry.error = error instanceof Error ? error.message : '读取飞书源表失败';
    } finally {
      entry.running = false;
      entry.dueAt = generation === entry.generation ? this.now() + this.interval : 0;
      this.active = false;
    }
  }
}
