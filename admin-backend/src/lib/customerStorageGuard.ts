import { statfs } from 'node:fs/promises';

export class CustomerStorageError extends Error {}

export function createCustomerStorageGuard(
  readAvailable = async () => {
    const stats = await statfs(process.env.CUSTOMER_SYNC_DISK_PATH || process.cwd());
    return stats.bavail * stats.bsize;
  },
  now = Date.now,
) {
  const minimum = 1024 ** 3;
  const resumeAt = minimum * 2;
  let checkedAt = -Infinity;
  let paused = false;
  let reason = '';
  let pending: Promise<boolean> | undefined;

  async function available() {
    if (pending) return pending;
    if (now() - checkedAt < 5000) return !paused;
    pending = (async () => {
      try {
        const bytes = await readAvailable();
        if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid disk capacity');
        // Hysteresis avoids repeatedly resuming writes close to the safety boundary.
        paused = bytes < (paused ? resumeAt : minimum);
        reason = paused ? '服务器磁盘空间不足，客户同步已暂停；进度已保留，剩余空间达到 2GB 后自动继续' : '';
      } catch {
        paused = true;
        reason = '暂时无法检查服务器磁盘空间，客户同步已暂停，进度已保留';
      } finally {
        checkedAt = now();
      }
      return !paused;
    })();
    try { return await pending; }
    finally { pending = undefined; }
  }

  return {
    available,
    get reason() { return reason; },
    async assertAvailable() {
      if (!await available()) throw new CustomerStorageError(reason);
    },
  };
}

export const customerStorage = createCustomerStorageGuard();
