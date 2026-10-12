import type { Customer } from '../api/entities';

export interface CustomerSnapshot {
  items: Customer[];
  warning: string;
  updatedAt: string;
}

export function customerCacheKey(owner: number, entity: number, employee?: string) {
  return JSON.stringify([owner, entity, employee ?? null]);
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('resource-admin-customers-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('客户缓存被其他页面占用'));
  });
}

export async function readCustomerCache(key: string): Promise<CustomerSnapshot | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function writeCustomerCache(key: string, value: CustomerSnapshot) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('缓存保存失败'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function readCustomerPreference(key: string): { entityId?: number; scope?: 'employee' | 'entity'; userId?: string } {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

export function writeCustomerPreference(key: string, value: object) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences are optional. */ }
}
