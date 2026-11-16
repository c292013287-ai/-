import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MigrationSource, MigrationSourceRecord } from './migrationSnapshots';

export interface Binding { label: string; entityId: number }
export interface MigrationAccess { source: MigrationSource; bindings: Binding[] }
const file = () => path.resolve(process.env.MIGRATION_SNAPSHOT_DIR || 'data/migration-snapshots', 'operator-access.json');
export const entityField = '选择要迁移用户的主体';
export async function readAccess(): Promise<MigrationAccess | null> {
  try { return JSON.parse(await readFile(file(), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export async function saveAccess(value: MigrationAccess) {
  const target=file(), temp=target+'.'+randomUUID()+'.tmp';
  await mkdir(path.dirname(target), {recursive:true,mode:0o700});
  await writeFile(temp,JSON.stringify(value),{mode:0o600});
  await rename(temp,target);
}
export const accessKey = (access:MigrationAccess) => createHash('sha256').update(JSON.stringify(access)).digest('hex');
export function scopedRows(rows:MigrationSourceRecord[], bindings:Binding[], ids:number[]) {
  const allowed=new Set(bindings.filter(b=>ids.includes(b.entityId)).map(b=>b.label));
  return rows.filter(row=>allowed.has(row.fields[entityField]?.trim()));
}
export function exactBindings(rows:MigrationSourceRecord[],entities:{id:number;name:string}[],saved:Binding[]) {
  const mapped=new Map(saved.map(binding=>[binding.label,binding.entityId]));
  const labels=new Set(rows.map(row=>row.fields[entityField]?.trim()).filter(Boolean));
  for(const label of labels){
    if(mapped.has(label))continue;
    const matches=entities.filter(entity=>entity.name.trim()===label);
    if(matches.length===1)mapped.set(label,matches[0].id);
  }
  return [...mapped].map(([label,entityId])=>({label,entityId}));
}
export function validOperation(fields:Record<string,unknown>, existing:Record<string,string>) {
  const keys=Object.keys(fields);
  if(keys.length===1 && typeof fields.备注==='string') return fields.备注.length<=2000;
  return keys.length===4 && Number.isSafeInteger(fields.转量数量) && Number(fields.转量数量)>=0
    && typeof fields.处理人==='string' && ['张磊','刘奕彤','李娜'].includes(fields.处理人)
    && Number.isSafeInteger(fields.处理时间) && Number(fields.处理时间)>0 && Number(fields.处理时间)<=8640000000000000
    && fields.操作状态==='推送' && ['', '-'].includes((existing.操作状态??'').trim());
}
