import type { AuthRequest } from './auth';

export function scopedIds(req: AuthRequest, requested?: unknown) {
  if (requested !== undefined) {
    const id = Number(requested);
    return req.userRole === 'admin' || req.entityIds?.includes(id) ? id : { in: [] as number[] };
  }
  return req.userRole === 'admin' ? undefined : { in: req.entityIds ?? [] };
}

// Legacy sources without a trustworthy entity mapping are admin-only.
export function allowed(req: AuthRequest) {
  if (req.userRole === 'admin') return true;
  const area = req.baseUrl.split('/').pop(), p = req.path.replace(/\/$/, ''), m = req.method;
  const can = (key: string) => req.permissions!.includes(key);
  if (area === 'auth') return p === '/me' && m === 'GET';
  if (area === 'migration') return can('migration') && (
    m === 'GET' && p === '/feishu/snapshot' || m === 'POST' && p === '/feishu/sync'
    || m === 'PATCH' && /^\/feishu\/records\/[a-zA-Z0-9_-]{1,100}$/.test(p)
  ) || area === 'migration' && can('migrationCollect') && m === 'GET' && p === '/feishu/records'
    || area === 'migration' && can('migrationBinding') && (
    m === 'GET' && p === '/operator-source/mappings' || m === 'PUT' && p === '/operator-source/mappings'
  );
  if (area === 'announcements') return !p && m === 'GET';
  if (area === 'workbench') return can('workbench');
  if (area === 'entities') {
    if (p === '/access') return m === 'GET' || m === 'POST';
    if (!p && m === 'GET') return ['entities','customers','warnings','consumption','recharges'].some(can);
    if (m === 'GET' && ['/manage','/served-users/jobs'].includes(p)) return can('entities');
    if (m === 'GET' && p === '/customers/jobs') return can('customers');
    if (m === 'POST' && p === '/customers/sync') return can('syncCustomers') && (req.body?.entityId === undefined || req.entityIds!.includes(req.body.entityId));
    const match = /^\/(\d+)(\/.*)?$/.exec(p);
    if (!match || !req.entityIds!.includes(Number(match[1]))) return false;
    if (!match[2] && m === 'PUT') return can('editEntity') && Object.keys(req.body ?? {}).every(k => ['certificationExpiresAt','externalContactCapacity','externalContactValidFrom','externalContactValidUntil'].includes(k));
    if (m === 'POST') return can('sync') && ['/sync','/served-users/sync'].includes(match[2]);
    if (m !== 'GET' || !can('customers') || (req.query.phone && !can('phone'))) return false;
    if (match[2] === '/customers/export') return can('exportCustomers');
    return ['/customers/snapshot','/customers/live-status','/employee-names'].includes(match[2]);
  }
  if (area === 'dashboard') return m === 'GET' && ['/stats','/budget'].includes(p) && can('warnings');
  if (area === 'consumption') return m === 'GET' && ['', '/trend'].includes(p) && can('consumption');
  if (area === 'recharges') {
    if (m === 'GET' && !p) return can('recharges');
    if (m === 'POST' && !p) return can('editRecharge') && req.entityIds!.includes(Number(req.body?.entityId));
    return m === 'PUT' && /^\/\d+$/.test(p) && can('editRecharge');
  }
  return false;
}
