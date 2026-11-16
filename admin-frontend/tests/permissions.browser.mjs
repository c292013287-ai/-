import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL});
const base=process.env.APP_URL||'http://127.0.0.1:5173';
const outputs='/private/tmp/resource-admin-permissions-ui';
await mkdir(outputs,{recursive:true});
try{
  for(const width of [1440,390]){
    for(const role of ['admin','viewer','operator']){
      const ctx=await browser.newContext({viewport:{width,height:940}});
      const user={id:role==='admin'?1:2,username:role,name:role==='admin'?'管理员':'只读账号',role,permissions:['entities']};
      const catalog={users:[{...user,status:'active',grants:[]}],entities:[{id:1,name:'测试主体'}],
        permissionNames:{entities:'查看主体',customers:'查看客户',workbench:'个人工作台'},
        roles:[['admin','超级管理员'],['manager','主体负责人'],['operator','运营人员'],['finance','财务人员'],['viewer','只读人员']].map(([code,name])=>({code,name,permissions:['entities']})),
        events:[{id:1,actor:1,action:'新增账号及授权',target:'2',createdAt:'2026-11-05T01:00:00Z'}]};
      const requests=[];
      if(role==='operator') user.permissions.push('migration');
      const fields={提交人:'授权测试提交人',选择要迁移用户的主体:'测试主体',备注:'测试备注',转量数量:'3',处理人:'张磊',处理时间:'2026-11-05'};
      const writes=[];
      await ctx.addInitScript(user=>{
        localStorage.setItem('token','ui-test');localStorage.setItem('user',JSON.stringify(user));sessionStorage.setItem('entity_access_token','test-gate');
      },user);
      await ctx.route(u=>u.pathname.startsWith('/api/'),async route=>{
        const p=new URL(route.request().url()).pathname;requests.push(p);
        if(p==='/api/migration/feishu/snapshot'){
          assert.ok(!new URL(route.request().url()).searchParams.has('appToken'));
          return route.fulfill({json:{ready:true,refreshing:false,error:'',records:[{recordId:'recTest',fields}],accessKey:'test-key',revision:'v1',updatedAt:new Date().toISOString()}});
        }
        if(p==='/api/migration/feishu/records/recTest'){
          assert.equal(new URL(route.request().url()).searchParams.get('accessKey'),'test-key');
          const write=route.request().postDataJSON().fields;
          Object.assign(fields,write);writes.push(write);
          return route.fulfill({json:{success:true}});
        }
        if(p==='/api/permissions/users'){
          const v=route.request().postDataJSON();assert.equal(v.role,'viewer');assert.deepEqual(v.entityIds,[]);
          catalog.users.push({id:3,username:v.username,name:v.name,role:v.role,status:v.status,grants:[]});
        }
        await route.fulfill({json:p==='/api/auth/me'?user:p==='/api/entities/access'?{valid:true}:p==='/api/permissions'?catalog:[]});
      });
      const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+(role==='operator'?'/migration':'/permissions'));
      if(role==='operator'){
        await page.getByText('授权测试提交人',{exact:true}).first().waitFor();
        assert.equal(await page.getByRole('button',{name:/采集信息|导出/}).count(),0);
        await page.getByRole('button',{name:'测试备注'}).first().click();
        const input=page.getByPlaceholder('请输入备注');await input.fill('已核对');await input.press('Enter');
        await page.getByRole('button',{name:'已核对'}).first().waitFor();
        assert.deepEqual(writes,[{备注:'已核对'}]);
        await page.getByRole('button',{name:'查看信息'}).first().click();
        assert.equal(await page.getByRole('dialog').getByRole('button',{name:/删.*除/}).count(),0);
        await page.getByRole('dialog').getByRole('button',{name:'点击推送'}).click();
        await page.waitForFunction(()=>document.body.textContent.includes('已回写处理信息'));
        assert.equal(writes.length,2);assert.equal(writes[1].操作状态,'推送');
        await page.goto(base+'/migration/collect');await page.getByText('无访问权限',{exact:true}).waitFor();
      }else if(role==='viewer'){
        await page.getByText('无访问权限',{exact:true}).waitFor();
        assert.ok(!requests.includes('/api/permissions'));
        assert.equal(await page.getByRole('menuitem',{name:'权限管理'}).count(),0);
      }else{
        await page.getByRole('button',{name:'新增账号'}).click();
        const dialog=page.getByRole('dialog');await dialog.getByLabel('登录账号').fill('demo-read');
        await dialog.getByLabel('姓名').fill('测试只读');await dialog.getByLabel('初始密码').fill('example-only-123');
        await dialog.getByRole('button',{name:/确.*定/}).click();await dialog.waitFor({state:'hidden'});
        const row=page.getByRole('row').filter({hasText:'demo-read'});
        assert.equal(await page.getByRole('columnheader',{name:'密码',exact:true}).count(),1);
        assert.equal(await row.getByLabel('密码已加密').textContent(),'********');
        await row.getByRole('button',{name:'重置密码',exact:true}).click();
        const editDialog=page.getByRole('dialog');
        assert.equal(await editDialog.getByLabel('重置密码',{exact:true}).inputValue(),'');
        assert.equal(await editDialog.getByLabel('登录账号').inputValue(),'demo-read');
        await editDialog.getByRole('button',{name:/取.*消/}).click();
        await row.getByRole('button',{name:'权限预览'}).click();
        await page.getByRole('dialog').getByText('查看主体',{exact:false}).waitFor();await page.keyboard.press('Escape');
        await page.getByRole('tab',{name:'角色设置'}).click();await page.getByText('查看客户',{exact:true}).waitFor();
        await page.getByRole('tab',{name:'安全操作记录'}).click();await page.getByText('新增账号及授权').waitFor();
        await page.getByRole('tab',{name:'登录账号'}).click();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:outputs+'/permissions-'+width+'.png',fullPage:true});
      }
      assert.deepEqual(errors,[]);await ctx.close();console.log('PASS',width,role);
    }
  }
}finally{await browser.close();}
