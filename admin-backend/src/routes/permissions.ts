import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest, authMiddleware, adminOnly } from '../middleware/auth';
import { entityManagementOnly } from '../middleware/entityManagement';
import { permissions, permissionNames, roleNames, validPolicy } from '../lib/permissions';
import { auditRetentionDays } from '../lib/securityAudit';

const router = Router();
router.use(authMiddleware, adminOnly, entityManagementOnly);
const exposed = { id:true, username:true, name:true, status:true, role:true, grants:{ select:{entityId:true} } };
router.get('/', async (_req,res) => {
  try {
    const [users, entities, policies, events] = await Promise.all([
      prisma.user.findMany({select:exposed,orderBy:{id:'asc'}}),
      prisma.wecomEntity.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
      prisma.rolePolicy.findMany(), prisma.securityEvent.findMany({where:{createdAt:{gte:new Date(Date.now()-auditRetentionDays()*86400000)}},take:200,orderBy:{id:'desc'}}),
    ]);
    res.json({users,entities,events,permissionNames,roles:Object.entries(roleNames).map(([code,name])=>({
      code,name,permissions:permissions(code,policies.find(p=>p.role===code)?.permissions)
    }))});
  } catch { res.status(503).json({error:'权限数据读取失败'}); }
});

class Invalid extends Error {}
function requireValue(ok: unknown, error: string): asserts ok { if(!ok) throw new Invalid(error); }
type Tx = Prisma.TransactionClient;
async function change(req: AuthRequest, operation: (tx:Tx)=>Promise<void>) {
  await prisma.$transaction(async tx=>{
    // Serialize administrative changes, including concurrent attempts to remove the last administrator.
    await tx.$queryRaw`SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE`;
    const actor=await tx.user.findUnique({where:{id:req.userId}});
    requireValue(actor?.role==='admin' && actor.status==='active' && actor.sessionVersion===req.sessionVersion,'管理员授权已变化');
    await operation(tx);
  },{isolationLevel:'Serializable'});
}
function errorReply(res: import('express').Response, e: unknown) {
  if(e instanceof Invalid) return res.status(400).json({error:e.message});
  if(e instanceof Prisma.PrismaClientKnownRequestError && e.code==='P2002') return res.status(409).json({error:'账号已存在'});
  return res.status(409).json({error:'保存未完成，请刷新后重试'});
}
router.put('/roles/:role',async(req:AuthRequest,res)=>{
  try {
    const role=String(req.params.role), keys=req.body.permissions;
    requireValue(Object.hasOwn(roleNames,role)&&role!=='admin'&&validPolicy(keys),'角色或权限组合无效，请同时勾选对应查看权限');
    await change(req,async tx=>{
      await tx.rolePolicy.upsert({where:{role},create:{role,permissions:keys},update:{permissions:keys}});
      await tx.user.updateMany({where:{role},data:{sessionVersion:{increment:1}}});
      await tx.securityEvent.create({data:{actor:req.userId!,action:'调整角色权限',target:role}});
    });
    res.json({success:true});
  } catch(e){errorReply(res,e);}
});
router.post('/users/:id/revoke',async(req:AuthRequest,res)=>{
  try {
    const id=Number(req.params.id); requireValue(Number.isSafeInteger(id)&&id>0,'账号无效');
    await change(req,async tx=>{
      await tx.user.update({where:{id},data:{sessionVersion:{increment:1}}});
      await tx.securityEvent.create({data:{actor:req.userId!,action:'强制退出',target:String(id)}});
    }); res.json({success:true});
  } catch(e){errorReply(res,e);}
});
async function save(req:AuthRequest,res:import('express').Response) {
  try {
    const id=req.params.id===undefined?undefined:Number(req.params.id);
    const {username,name,role,status,password,entityIds}=req.body;
    requireValue(id===undefined || Number.isSafeInteger(id)&&id>0,'账号无效');
    requireValue(typeof name==='string' && name.trim().length>0 && name.length<=64 && typeof role==='string' && Object.hasOwn(roleNames,role) && ['active','disabled'].includes(status),'姓名、角色或状态无效');
    requireValue(id!==undefined || typeof username==='string' && /^[a-zA-Z0-9_.-]{3,64}$/.test(username),'账号须为3至64位字母、数字或 ._-');
    requireValue(password===undefined && id!==undefined || typeof password==='string' && password.length>=10 && Buffer.byteLength(password)<=72,'新密码至少10位且不超过72字节');
    requireValue(Array.isArray(entityIds)&&entityIds.length<=1000&&entityIds.every(v=>Number.isSafeInteger(v)&&v>0)&&new Set(entityIds).size===entityIds.length,'主体范围无效');
    const hash=password===undefined?undefined:await bcrypt.hash(password,12);
    await change(req,async tx=>{
      if(id===req.userId) requireValue(role==='admin'&&status==='active','不能停用或降权当前管理员');
      const scopes=role==='admin'?[]:entityIds;
      requireValue(await tx.wecomEntity.count({where:{id:{in:scopes}}})===scopes.length,'所选主体不存在');
      const data={name:name.trim(),role,status,password:hash};
      const user=id===undefined?await tx.user.create({data:{...data,username,password:hash!}}):
        await tx.user.update({where:{id},data:{...data,sessionVersion:{increment:1}}});
      await tx.userEntityGrant.deleteMany({where:{userId:user.id}});
      if(scopes.length) await tx.userEntityGrant.createMany({data:scopes.map((entityId:number)=>({userId:user.id,entityId}))});
      await tx.securityEvent.create({data:{actor:req.userId!,action:id===undefined?'新增账号及授权':hash?'重置密码及授权':'调整账号及授权',target:String(user.id)}});
    });
    res.status(id===undefined?201:200).json({success:true});
  } catch(e){errorReply(res,e);}
}
router.post('/users',save);
router.put('/users/:id',save);
export default router;
