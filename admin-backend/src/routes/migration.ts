import { Router, Response } from 'express';
import axios from 'axios';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { adminOnly, authMiddleware, AuthRequest } from '../middleware/auth';
import { MigrationSnapshots, MigrationSource } from '../lib/migrationSnapshots';

import prisma from '../lib/prisma';
import { audit } from '../lib/securityAudit';
import { entityManagementOnly } from '../middleware/entityManagement';
import { accessKey, entityField, exactBindings, readAccess, saveAccess, scopedRows, validOperation, type Binding } from '../lib/migrationAccess';

const router = Router();
router.use(authMiddleware);

interface FeishuTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
  created_time?: number;
}

interface FeishuRecordsResponse {
  code: number;
  msg?: string;
  data?: {
    items?: FeishuRecord[];
    page_token?: string;
    has_more?: boolean;
  };
}

interface FeishuUpdateRecordResponse {
  code: number;
  msg?: string;
}

interface FeishuWikiNodeResponse {
  code: number;
  msg?: string;
  data?: {
    node?: {
      obj_token?: string;
      obj_type?: string;
    };
  };
}

type NormalizedRecord = { recordId: string; createdTime?: number; fields: Record<string, string> };
const feishu = axios.create({ timeout: 20_000 });
let tokenCache: { key: string; token: string; expiresAt: number } | undefined;
const wikiCache = new Map<string, { token: string; expiresAt: number }>();
const recordLoads = new Map<string, Promise<NormalizedRecord[]>>();
const snapshots = new MigrationSnapshots({
  directory: () => path.resolve(process.env.MIGRATION_SNAPSHOT_DIR || 'data/migration-snapshots'),
  fingerprint: credentialsKey,
  load: async source => {
    try { return await sharedRecords(source); }
    catch (error) { throw new Error(sourceError(error).message); }
  },
});
export const startMigrationSnapshots = () => snapshots.start();

function credentialsKey() {
  return createHash('sha256').update(JSON.stringify([process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET])).digest('hex');
}

function normalizeFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeFieldValue).filter(Boolean).join('、');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.value === 'string' || typeof obj.value === 'number') return String(obj.value);
    if (typeof obj.link === 'string') return obj.link;
  }
  return JSON.stringify(value);
}

async function getTenantAccessToken(signal?: AbortSignal) {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('请先配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
  }

  const key = credentialsKey();
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const { data } = await feishu.post<FeishuTokenResponse>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret },
    { signal },
  );

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || '获取飞书 tenant_access_token 失败');
  }

  tokenCache = {
    key, token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max(0, Math.min(data.expire || 300, 7200) - 60) * 1000,
  };
  return tokenCache.token;
}

async function resolveBitableAppToken(inputToken: string, tenantAccessToken: string, signal?: AbortSignal) {
  if (/^base/i.test(inputToken) || /^basc/i.test(inputToken)) return inputToken;

  const key = `${credentialsKey()}:${inputToken}`;
  const cached = wikiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const { data } = await feishu.get<FeishuWikiNodeResponse>(
    'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node',
    {
      headers: { Authorization: `Bearer ${tenantAccessToken}` },
      params: { token: inputToken },
      signal,
    },
  );

  if (data.code !== 0 || !data.data?.node?.obj_token) {
    throw new Error(data.msg || '无法从飞书 Wiki 链接解析多维表格 App Token');
  }

  if (data.data.node.obj_type && data.data.node.obj_type !== 'bitable') {
    throw new Error('该飞书 Wiki 链接不是多维表格，请确认采集表链接');
  }

  if (wikiCache.size >= 50) wikiCache.clear();
  wikiCache.set(key, { token: data.data.node.obj_token, expiresAt: Date.now() + 300_000 });
  return data.data.node.obj_token;
}

async function readAllRecords(appToken: string, tableId: string, viewId: string) {
  // Keep the whole load below the proxy deadline; never publish an incomplete page set.
  const signal = AbortSignal.timeout(50_000);
  const token = await getTenantAccessToken(signal);
  const bitableAppToken = await resolveBitableAppToken(appToken, token, signal);
  const records: NormalizedRecord[] = [];
  const seenTokens = new Set<string>();
  let pageToken = '';
  do {
    const { data } = await feishu.get<FeishuRecordsResponse>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records`,
      {
        signal,
        headers: { Authorization: `Bearer ${token}` },
        params: { page_size: 500, page_token: pageToken || undefined, view_id: viewId || undefined },
      },
    );
    if (data.code !== 0) {
      tokenCache = undefined;
      throw new Error(data.msg || '获取飞书表记录失败');
    }
    if (!Array.isArray(data.data?.items) || typeof data.data.has_more !== 'boolean') {
      throw new Error('飞书返回的分页数据不完整，请重试');
    }
    for (const item of data.data.items) {
      if (!item.record_id || !item.fields || typeof item.fields !== 'object') throw new Error('飞书返回的记录不完整，请重试');
      const fields = Object.fromEntries(Object.entries(item.fields).map(([key, value]) => [key, normalizeFieldValue(value)]));
      records.push({ recordId: item.record_id, createdTime: item.created_time, fields });
    }
    pageToken = data.data.has_more ? (data.data.page_token || '') : '';
    if (data.data.has_more && (!pageToken || seenTokens.has(pageToken))) throw new Error('飞书分页游标异常，请重试');
    seenTokens.add(pageToken);
  } while (pageToken);
  return records;
}

function sharedRecords({ appToken, tableId, viewId }: MigrationSource) {
  const key = JSON.stringify([credentialsKey(), appToken, tableId, viewId]);
  let loading = recordLoads.get(key);
  if (!loading) {
    loading = readAllRecords(appToken, tableId, viewId).finally(() => recordLoads.delete(key));
    recordLoads.set(key, loading);
  }
  return loading;
}

function sourceFromQuery(query: Record<string, unknown>): MigrationSource {
  const source = { appToken: String(query.appToken || '').trim(), tableId: String(query.tableId || '').trim(), viewId: String(query.viewId || '').trim() };
  if (!source.appToken || !source.tableId || Object.values(source).some(value => value && !/^[A-Za-z0-9_-]{1,200}$/.test(value))) {
    throw new Error('缺少或无效的飞书 App Token、Table ID 或 View ID');
  }
  return source;
}

function sourceError(error: unknown) {
  const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
  const responseMessage = responseData && typeof responseData === 'object' && 'msg' in responseData
    ? String((responseData as { msg?: string }).msg || '') : '';
  const timedOut = axios.isCancel(error) || (axios.isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code || ''));
  return { timedOut, message: timedOut ? '飞书源表读取超时' : responseMessage || (error instanceof Error ? error.message : '获取飞书提交信息失败') };
}

router.get('/operator-source', entityManagementOnly, async (req,res)=>{
  try {
    const source=sourceFromQuery(req.query);
    const snapshot=await snapshots.read(source);
    if(!snapshot.ready || !snapshot.records) return res.status(409).json({error:'源表尚未就绪，请稍后重试'});
    const entities=await prisma.wecomEntity.findMany({select:{id:true,name:true},orderBy:{id:'asc'}});
    const saved=await readAccess();
    const same= saved && JSON.stringify(saved.source)===JSON.stringify(source);
    const labels=[...new Set([...snapshot.records.map(r=>r.fields[entityField]?.trim()).filter(Boolean),...(same?saved.bindings.map(b=>b.label):[])])].sort();
    const bindings=labels.map(label=>{
      const exact=entities.filter(e=>e.name.trim()===label);
      return {label,entityId:same?saved.bindings.find(b=>b.label===label)?.entityId:(exact.length===1?exact[0].id:undefined)};
    });
    res.json({entities,bindings});
  } catch {res.status(400).json({error:'无法读取主体对应关系，请检查源表配置'});}
});
router.put('/operator-source',entityManagementOnly,async(req:AuthRequest,res)=>{
  try {
    const source=sourceFromQuery(req.body?.source??{});
    const bindings:Binding[]=req.body?.bindings;
    const entities=await prisma.wecomEntity.findMany({select:{id:true}});
    const ids=new Set(entities.map(e=>e.id));
    if(!Array.isArray(bindings)||bindings.length>2000||bindings.some(b=>!b||typeof b.label!=='string'||!b.label.trim()||b.label!==b.label.trim()||b.label.length>200||!ids.has(b.entityId))
      || new Set(bindings.map(b=>b.label)).size!==bindings.length) return res.status(400).json({error:'主体对应关系无效'});
    const access={source,bindings:bindings.map(({label,entityId})=>({label,entityId}))};
    await audit(req.userId!, '申请保存运营迁移范围', accessKey(access));
    await saveAccess(access);
    res.json({success:true});
  } catch {res.status(400).json({error:'无法保存运营源表配置'});}
});
router.put('/operator-source/publish',adminOnly,async(req:AuthRequest,res)=>{
  try {
    const source=sourceFromQuery(req.body?.source??{});
    const previous=await readAccess();
    const bindings=previous&&JSON.stringify(previous.source)===JSON.stringify(source)?previous.bindings:[];
    await saveAccess({source,bindings});
    await audit(req.userId!,'发布共享迁移源表配置',accessKey({source,bindings}));
    void snapshots.read(source).catch(()=>console.error('[MigrationSync] Shared source refresh could not start'));
    res.json({success:true});
  } catch {res.status(400).json({error:'共享源表配置无效'});}
});
router.get('/operator-source/mappings',async(req:AuthRequest,res)=>{
  try {
    const access=await readAccess();
    if(!access)return res.status(409).json({error:'管理员尚未配置迁移源表'});
    const snapshot=await snapshots.read(access.source);
    if(!snapshot.ready||!snapshot.records)return res.status(409).json({error:'迁移源表尚未就绪'});
    const labels=[...new Set([...snapshot.records.map(r=>r.fields[entityField]?.trim()).filter(Boolean),...access.bindings.map(b=>b.label)])].sort();
    const entities=await prisma.wecomEntity.findMany({where:{id:{in:req.entityIds??[]}},select:{id:true,name:true},orderBy:{name:'asc'}});
    res.json({labels,entities,bindings:access.bindings.filter(b=>(req.entityIds??[]).includes(b.entityId))});
  } catch {res.status(503).json({error:'读取匹配选项失败'});}
});
router.put('/operator-source/mappings',async(req:AuthRequest,res)=>{
  try {
    const {label,entityId}=req.body??{};
    if(typeof label!=='string'||!label.trim()||label!==label.trim()||!Number.isSafeInteger(entityId)||!(req.entityIds??[]).includes(entityId))
      return res.status(400).json({error:'只能匹配到自己已授权的主体'});
    const access=await readAccess();
    if(!access)return res.status(409).json({error:'管理员尚未配置迁移源表'});
    const snapshot=await snapshots.read(access.source);
    if(!snapshot.ready||!snapshot.records)return res.status(409).json({error:'迁移源表尚未就绪'});
    const labels=new Set(snapshot.records.map(r=>r.fields[entityField]?.trim()).filter(Boolean));
    if(!labels.has(label))return res.status(400).json({error:'源表选项不存在'});
    const bindings=access.bindings.filter(b=>b.label!==label);
    bindings.push({label,entityId});
    await saveAccess({...access,bindings});
    await audit(req.userId!,'匹配迁移源表主体',String(entityId));
    res.json({success:true});
  } catch {res.status(503).json({error:'匹配保存失败，请重试'});}
});
async function operatorSnapshot(req:AuthRequest,res:Response,force:boolean) {
  if(Object.keys(req.query).some(k=>k!=='revision')) return res.status(403).json({error:'不能指定其他源表'});
  const access=await readAccess();
  if(!access) return res.status(409).json({error:'管理员尚未配置运营迁移源表'});
  const snap=await snapshots.read(access.source,'',force);
  const key=accessKey(access);
  const rev=createHash('sha256').update(JSON.stringify([key,snap.revision,req.entityIds,req.permissions?.includes('phone')])).digest('hex');
  const entities=snap.records?await prisma.wecomEntity.findMany({select:{id:true,name:true}}):[];
  const bindings=snap.records?exactBindings(snap.records,entities,access.bindings):access.bindings;
  const records=snap.records && rev!==req.query.revision ? scopedRows(snap.records,bindings,req.entityIds??[]).map(row=>{
    const fields=Object.fromEntries(Object.entries(row.fields).filter(([k])=>operatorColumns.has(k)).map(([k,v])=>
      [k,k.includes('手机号') && v && !req.permissions?.includes('phone')?'已脱敏':v]));
    return {...row,fields};
  }) : undefined;
  res.json({...snap,records,revision:rev,accessKey:key,error:snap.error?'源表刷新失败，请稍后重试':''});
}
const operatorColumns=new Set('案例ID 提交人 上级 所属SKU 选择要迁移用户的主体 迁移账号姓名 迁移账号对内昵称 迁移账号绑定手机号 承接账号姓名 承接账号对内昵称 承接账号对你昵称 承接账号绑定手机号 迁移类型 迁移客户数量 迁移用户完整标签 迁移话术 迁移客户原因 定性 leader是否同意 转量数量 处理人 处理时间 登记时间 操作状态 备注'.split(' '));
const operatorWrites=new Set<string>();
router.get('/feishu/snapshot', async (req: AuthRequest, res: Response) => {
  if(req.userRole!=='admin') {try {await operatorSnapshot(req,res,false);} catch {res.status(503).json({error:'无法读取迁移源表'});}return;}
  let source: MigrationSource;
  try { source = sourceFromQuery(req.query); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    const value = await snapshots.read(source, String(req.query.revision || ''));
    res.setHeader('Cache-Control', 'no-store');
    res.json(value);
  } catch { res.status(503).json({ error: '源表同步服务暂不可用，已有数据已保留' }); }
});

router.post('/feishu/sync', async (req: AuthRequest, res: Response) => {
  if(req.userRole!=='admin') {try {await operatorSnapshot(req,res,true);} catch {res.status(503).json({error:'无法刷新迁移源表'});}return;}
  let source: MigrationSource;
  try { source = sourceFromQuery(req.query); }
  catch (error) { return res.status(400).json({ error: (error as Error).message }); }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await snapshots.read(source, String(req.query.revision || ''), true));
  } catch { res.status(503).json({ error: '无法启动源表同步，已有数据已保留' }); }
});

router.get('/feishu/records', async (req: AuthRequest, res: Response) => {
  try {
    const appToken = String(req.query.appToken || '').trim();
    const tableId = String(req.query.tableId || '').trim();
    const viewId = String(req.query.viewId || '').trim();

    if (!appToken || !tableId) {
      return res.status(400).json({ error: '缺少 appToken 或 tableId' });
    }

    const source={appToken,tableId,viewId};
    let records = await sharedRecords(source);
    if(req.userRole!=='admin'){
      const access=await readAccess();
      if(!access||JSON.stringify(access.source)!==JSON.stringify(source))return res.status(403).json({error:'只能读取管理员配置的迁移源表'});
      const entities=await prisma.wecomEntity.findMany({select:{id:true,name:true}});
      records=scopedRows(records,exactBindings(records,entities,access.bindings),req.entityIds??[]).map(row=>({...row,fields:Object.fromEntries(
        Object.entries(row.fields).filter(([key])=>operatorColumns.has(key)).map(([key,value])=>
          [key,key.includes('手机号')&&value&&!req.permissions?.includes('phone')?'已脱敏':value])
      )}));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ records });
  } catch (error) {
    const { timedOut, message } = sourceError(error);
    res.status(timedOut ? 504 : 502).json({ error: message });
  }
});

router.patch('/feishu/records/:recordId', async (req: AuthRequest, res: Response) => {
  let lock:string|undefined;
  try {
    let appToken = String(req.query.appToken || '').trim();
    let tableId = String(req.query.tableId || '').trim();
    const recordId = String(req.params.recordId || '').trim();
    const fields = req.body?.fields;

    if(req.userRole!=='admin'){
      const access=await readAccess();
      if(!access || Object.keys(req.query).some(k=>k!=='accessKey') || req.query.accessKey!==accessKey(access))
        return res.status(403).json({error:'迁移授权或源表已变化，请刷新列表'});
      if(!fields || typeof fields!=='object' || Array.isArray(fields)) return res.status(400).json({error:'无效处理字段'});
      const key=accessKey(access)+':'+recordId;
      if(operatorWrites.has(key)) return res.status(409).json({error:'记录正在处理，请稍后刷新'});
      operatorWrites.add(key);lock=key;
      const rows=await sharedRecords(access.source);
      const entities=await prisma.wecomEntity.findMany({select:{id:true,name:true}});
      const row=scopedRows(rows,exactBindings(rows,entities,access.bindings),req.entityIds??[]).find(r=>r.recordId===recordId);
      if(!row) return res.status(403).json({error:'该记录不在授权范围'});
      if(!validOperation(fields,row.fields)) return res.status(400).json({error:'只能修改备注或提交完整且尚未推送的处理信息'});
      const current=await readAccess();
      if(!current || accessKey(current)!==accessKey(access))return res.status(409).json({error:'源表配置已变更，请刷新'});
      appToken=access.source.appToken;tableId=access.source.tableId;
    }
    if (!appToken || !tableId || !recordId) {
      return res.status(400).json({ error: '缺少 appToken、tableId 或 recordId' });
    }

    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ error: '缺少要更新的飞书字段' });
    }

    const token = await getTenantAccessToken();
    const bitableAppToken = await resolveBitableAppToken(appToken, token);
    const { data } = await feishu.put<FeishuUpdateRecordResponse>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableAppToken}/tables/${tableId}/records/${recordId}`,
      { fields },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (data.code !== 0) {
      return res.status(502).json({ error: req.userRole==='admin' && data.msg || '更新飞书记录失败' });
    }

    snapshots.invalidate(appToken, tableId);
    res.json({ success: true });
  } catch (error) {
    const responseData = axios.isAxiosError(error) ? error.response?.data : undefined;
    const responseMessage = responseData && typeof responseData === 'object' && 'msg' in responseData
      ? String((responseData as { msg?: string }).msg || '')
      : '';
    const message = responseMessage || (error instanceof Error ? error.message : '更新飞书记录失败');
    res.status(500).json({ error: req.userRole==='admin' ? message : '更新失败，请刷新后重试' });
  } finally { if(lock) operatorWrites.delete(lock); }
});

export default router;
