import type { ServedUserProgress } from './servedUserCount';

export interface ServedUserJob extends ServedUserProgress {
  entityId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: { servedUserCount: number; servedUserCountUpdatedAt: string };
}

type Runner = (id: number, progress: (value: ServedUserProgress) => void) => Promise<NonNullable<ServedUserJob['result']>>;

// One latest job per entity; credentials and contact IDs never enter job responses.
export class ServedUserJobs {
  private jobs = new Map<number, ServedUserJob>();
  private active = 0;
  private run: Runner;
  private concurrency: number;
  constructor(run: Runner, concurrency = 2) {
    this.run = run;
    this.concurrency = concurrency;
  }

  list() { return [...this.jobs.values()].map(job => ({ ...job })); }

  start(entityId: number) {
    const previous = this.jobs.get(entityId);
    if (previous && ['queued', 'running'].includes(previous.status)) return { ...previous };
    const job: ServedUserJob = { entityId, status: 'queued', startedAt: new Date().toISOString(), pages: 0, rows: 0, uniqueUsers: 0 };
    this.jobs.set(entityId, job);
    this.drain();
    return { ...job };
  }

  private drain() {
    for (const job of this.jobs.values()) {
      if (this.active >= this.concurrency) break;
      if (job.status !== 'queued') continue;
      this.active++;
      job.status = 'running';
      void this.execute(job);
    }
  }

  private async execute(job: ServedUserJob) {
    try {
      job.result = await this.run(job.entityId, progress => Object.assign(job, progress));
      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error && !('code' in error) ? error.message : '统计失败，请重新发起';
    } finally {
      job.finishedAt = new Date().toISOString();
      this.active--;
      this.drain();
    }
  }
}
