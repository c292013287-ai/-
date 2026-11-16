import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {PrismaClient} from '@prisma/client';

test('permissions enforce data scope, protect settings, revoke sessions and audit without storing secrets',async()=>{
  const url=new URL(process.env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const owner=new PrismaClient(), database='rbac_test_'+randomUUID().replaceAll('-','');
  await owner.$executeRawUnsafe('CREATE DATABASE '+database);
  let db,server;
  try{
    url.pathname='/'+database; process.env.DATABASE_URL=url.toString();
    process.env.JWT_SECRET=randomUUID();process.env.ENTITY_MANAGEMENT_USERNAME='gate';
    const password=randomUUID();
    process.env.ENTITY_MANAGEMENT_PASSWORD_HASH=await bcrypt.hash(password,4);
    execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{stdio:'pipe'});
    const require=createRequire(import.meta.url);
    db=require('../src/lib/prisma.ts').default;
    const admin=await db.user.create({data:{username:'root-test',name:'Root',role:'admin',password:await bcrypt.hash(password,4)}});
    const app=express();app.use(express.json());
    for(const area of ['auth','entities','permissions','consumption','dashboard','recharges','migration','workbench'])
      app.use('/api/'+area,require('../src/routes/'+area+'.ts').default);
    const jobs=require('../src/services/customerSyncJobs.ts').customerSyncJobs;
    const a=await db.wecomEntity.create({data:{name:'Subject A',corpid:'A',secret:randomUUID()}});
    const b=await db.wecomEntity.create({data:{name:'Subject B',corpid:'B',secret:randomUUID()}});
    jobs.status=async()=>[a,b].map(e=>({entityId:e.id}));
    jobs.snapshot=async()=>({items:[{remarkMobiles:['13800000000']}]});
    let queued; jobs.start=async ids=>{queued=ids;return jobs.status();};
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    async function call(path,method='GET',headers={},body){
      const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body&&JSON.stringify(body)});
      return {status:r.status,data:await r.json().catch(()=>null)};
    }
    async function login(username,root=false){
      const login=await call('auth/login','POST',{}, {username,password});assert.equal(login.status,200);
      const h={Authorization:'Bearer '+login.data.token};
      const gate=await call('entities/access','POST',h,{username:root?'gate':username,password});assert.equal(gate.status,200);
      return {...h,'X-Entity-Access-Token':gate.data.accessToken};
    }
    const root=await login(admin.username,true);
    assert.equal((await call('permissions')).status,401);
    assert.equal((await call('permissions','GET',{Authorization:root.Authorization})).status,403);
    assert.equal((await call('permissions','GET',root)).data.roles.length,5);
    async function create(role){
      const username=role+'-test';
      const r=await call('permissions/users','POST',root,{role,username,name:role,status:'active',password,entityIds:[a.id]});
      assert.equal(r.status,201);
      return login(username);
    }
    const manager=await create('manager'),finance=await create('finance'),viewer=await create('viewer'),operator=await create('operator');
    for(const h of [manager,finance,viewer,operator]){
      assert.equal((await call('permissions','GET',h)).status,403);
      assert.deepEqual((await call('entities','GET',h)).data.map(e=>e.id),[a.id]);
      const list=await call('entities/manage','GET',h);assert.equal(list.data.length,1);assert.ok(!('secret' in list.data[0]));
      assert.equal((await call('migration/feishu/records','GET',h)).status,403);
      assert.equal((await call('entities/'+b.id+'/customers/snapshot','GET',h)).status,403);
    }
    assert.equal((await call('entities/'+a.id,'PUT',manager,{secret:'override'})).status,403);
    assert.equal((await call('entities/'+a.id,'PUT',viewer,{externalContactCapacity:5000})).status,403);
    const updated=await call('entities/'+a.id,'PUT',manager,{externalContactCapacity:5000});assert.equal(updated.status,200);assert.ok(!('secret' in updated.data));
    assert.equal((await call('entities/'+a.id+'/customers/snapshot','GET',operator)).data.items[0].remarkMobiles[0],'已脱敏');
    assert.equal((await call('entities/'+a.id+'/customers/export','GET',operator)).status,403);
    assert.equal((await call('entities/customers/sync','POST',manager,{})).data.length,1);assert.deepEqual(queued,[a.id]);
    assert.equal((await call('dashboard/stats','GET',manager)).data.entityCount,1);
    const recharge=async(entity,fee)=>db.rechargeRecord.create({data:{entityId:entity.id,amount:1,feeAmount:fee,rechargeDate:new Date()}});
    await recharge(a,11);const other=await recharge(b,99);
    const totals=await call('recharges','GET',finance);assert.equal(totals.data.total,1);assert.equal(totals.data.monthlyTotal,11);
    assert.equal((await call('recharges/'+other.id,'PUT',finance,{feeAmount:1})).status,404);
    assert.equal((await call('recharges','POST',finance,{entityId:b.id,amount:1})).status,403);
    const self=await call('permissions/users/'+admin.id,'PUT',root,{name:'Root',role:'viewer',status:'active',entityIds:[]});assert.equal(self.status,400);
    assert.equal((await call('permissions/roles/viewer','PUT',root,{permissions:['workbench']})).status,200);
    assert.equal((await call('auth/me','GET',viewer)).status,401);
    const relog=await login('viewer-test');assert.equal((await call('entities/manage','GET',relog)).status,403);
    const actor=await db.user.findUnique({where:{username:'manager-test'}});
    assert.equal((await call('permissions/users/'+actor.id+'/revoke','POST',root,{})).status,200);
    assert.equal((await call('auth/me','GET',manager)).status,401);
    const fresh=await login('manager-test');
    assert.equal((await call('entities/manage','GET',{Authorization:fresh.Authorization,'X-Entity-Access-Token':manager['X-Entity-Access-Token']})).status,403);
    assert.equal((await call('auth/me','GET',{Authorization:'Bearer '+fresh['X-Entity-Access-Token']})).status,401);
    assert.equal((await call('permissions/users/'+actor.id,'PUT',root,{name:'停用',role:'manager',status:'disabled',entityIds:[]})).status,200);
    assert.equal((await call('auth/me','GET',fresh)).status,401);
    const events=await db.securityEvent.findMany();assert.ok(events.length>=7);
    assert.ok(!JSON.stringify(events).includes(password));assert.ok(!JSON.stringify(events).includes('13800000000'));
    assert.ok(!jwt.decode(root.Authorization.slice(7)).scope);
  }finally{
    if(server)await new Promise(done=>server.close(done));
    await db?.$disconnect();
    await owner.$executeRawUnsafe('DROP DATABASE '+database);await owner.$disconnect();
  }
});
