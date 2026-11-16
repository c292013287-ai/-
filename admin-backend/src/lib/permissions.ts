export const roleNames: Record<string, string> = { admin: '超级管理员', manager: '主体负责人', operator: '运营人员', finance: '财务人员', viewer: '只读人员' };
export const permissionNames: Record<string, string> = {
  migration: '用户迁移查看与处理', migrationCollect: '采集信息', migrationBinding: '匹配迁移源表', warnings: '查看资源预警', entities: '查看主体', editEntity: '维护主体有效期和规模', sync: '同步主体与统计人数', customers: '查看客户',
  syncCustomers: '同步客户', exportCustomers: '导出客户', phone: '查看客户备注手机号',
  consumption: '查看消耗', recharges: '查看充值', editRecharge: '维护充值', workbench: '个人工作台',
};
const defaults: Record<string, string[]> = {
  manager: ['warnings','entities','editEntity','sync','customers','syncCustomers','consumption','workbench'],
  operator: ['migration','migrationCollect','migrationBinding','entities','customers','workbench'], finance: ['warnings','entities','consumption','recharges','editRecharge','workbench'],
  viewer: ['entities','workbench'],
};
export function permissions(role: string, override?: unknown): string[] {
  if (role === 'admin') return Object.keys(permissionNames);
  if (!Object.hasOwn(defaults, role)) return [];
  return (Array.isArray(override) ? override : defaults[role]).filter(key => typeof key === 'string' && Object.hasOwn(permissionNames, key));
}
export function validPolicy(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > Object.keys(permissionNames).length || !value.every(k => typeof k === 'string' && Object.hasOwn(permissionNames,k))) return false;
  return Object.entries({editEntity:'entities',sync:'entities',syncCustomers:'customers',exportCustomers:'customers',phone:'customers',editRecharge:'recharges'})
    .every(([child,parent]) => !value.includes(child) || value.includes(parent));
}
