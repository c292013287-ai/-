import {useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Form,Input,Modal,Popconfirm,Select,Space,Table,Tabs,Tag,Tooltip,message} from 'antd';
import {EditOutlined,EyeOutlined,KeyOutlined,LogoutOutlined,PlusOutlined,ReloadOutlined,SaveOutlined} from '@ant-design/icons';
import client from '../api/client';
import {getEntityAccessToken} from '../api/entities';
import PageHeader from '../components/PageHeader';

interface Account {id:number;username:string;name:string;role:string;status:string;grants:{entityId:number}[]}
interface Catalog {users:Account[];entities:{id:number;name:string}[];roles:{code:string;name:string;permissions:string[]}[];
  permissionNames:Record<string,string>;events:{id:number;actor:number;action:string;target:string;createdAt:string}[]}
const config=()=>({headers:{'X-Entity-Access-Token':getEntityAccessToken()||''}});
const failure=(e:unknown)=>(e as {response?:{data?:{error?:string}}})?.response?.data?.error||'请求失败，请重试';
export default function Permissions(){
  const [data,setData]=useState<Catalog>(); const [error,setError]=useState('');
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<Account|null|undefined>(undefined);
  const [preview,setPreview]=useState<Account|null>(null);
  const [role,setRole]=useState('manager'),[keys,setKeys]=useState<string[]>([]);
  const [form]=Form.useForm();const selectedRole=Form.useWatch('role',form);
  const load=async()=>{setLoading(true);try{const r=await client.get<Catalog>('/permissions',config());setData(r.data);setError('');}
    catch(e){setError(failure(e));}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  useEffect(()=>{setKeys(data?.roles.find(r=>r.code===role)?.permissions??[]);},[role,data]);
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);try{await action();message.success('已保存');await load();}catch(e){message.error(failure(e));}finally{setBusy(false);}};
  const edit=(a:Account|null)=>{setEditing(a);form.resetFields();form.setFieldsValue(a?{...a,password:'',entityIds:a.grants.map(g=>g.entityId)}:{role:'viewer',status:'active',entityIds:[]});};
  const roleName=(code:string)=>data?.roles.find(r=>r.code===code)?.name||code;
  const scope=(a:Account)=>a.role==='admin'?'全部主体':data?.entities.filter(e=>a.grants.some(g=>g.entityId===e.id)).map(e=>e.name).join('、')||'未授权主体';
  const roleKeys=(code:string)=>data?.roles.find(r=>r.code===code)?.permissions.map(k=>data.permissionNames[k]).join('、')||'无业务权限';
  return <section><PageHeader title="权限管理" extra={<Space wrap><Button icon={<ReloadOutlined/>} loading={loading} onClick={load}>刷新</Button>
    <Button type="primary" disabled={!data} icon={<PlusOutlined/>} onClick={()=>edit(null)}>新增账号</Button></Space>}/>
    {error&&<Alert type="error" showIcon message={error}/>}
    <Tabs items={[
      {key:'accounts',label:'登录账号',children:<Table<Account> rowKey="id" scroll={{x:920}} loading={loading} dataSource={data?.users} columns={[
        {title:'账号',dataIndex:'username'},
        {title:'密码',key:'password',width:140,render:(_,a)=><Space>
          <Tooltip title="密码已加密保存，无法查看原密码"><span aria-label="密码已加密">********</span></Tooltip>
          <Tooltip title="重置密码"><Button size="small" aria-label="重置密码" icon={<KeyOutlined/>} onClick={()=>edit(a)}/></Tooltip>
        </Space>},
        {title:'姓名',dataIndex:'name'},{title:'角色',dataIndex:'role',render:roleName},
        {title:'主体范围',render:(_,a)=>scope(a),ellipsis:true},{title:'状态',dataIndex:'status',render:s=><Tag color={s==='active'?'green':'default'}>{s==='active'?'启用':'停用'}</Tag>},
        {title:'操作',width:150,render:(_,a)=><Space><Button size="small" aria-label="权限预览" title="权限预览" icon={<EyeOutlined/>} onClick={()=>setPreview(a)}/>
          <Button size="small" aria-label="编辑账号" title="编辑账号" icon={<EditOutlined/>} onClick={()=>edit(a)}/>
          <Popconfirm title={'强制 '+a.name+' 退出所有登录？'} onConfirm={()=>run(()=>client.post('/permissions/users/'+a.id+'/revoke',{},config()))}>
            <Button size="small" disabled={busy} aria-label="强制退出" title="强制退出" icon={<LogoutOutlined/>}/></Popconfirm></Space>},
      ]}/>},
      {key:'roles',label:'角色设置',children:<Space direction="vertical" size="large">
        <Select aria-label="选择角色" value={role} style={{width:200}} onChange={setRole} options={data?.roles.map(r=>({value:r.code,label:r.name}))}/>
        {role==='admin'?<p>全部业务权限；工作台内容仅本人可见。</p>:<Checkbox.Group value={keys} onChange={v=>setKeys(v as string[])}
          options={Object.entries(data?.permissionNames??{}).map(([value,label])=>({value,label}))}/>}
        {role!=='admin'&&<Popconfirm title="保存后该角色的账号需要重新登录，确定继续？" onConfirm={()=>run(()=>client.put('/permissions/roles/'+role,{permissions:keys},config()))}>
          <Button disabled={!data||loading} loading={busy} type="primary" icon={<SaveOutlined/>}>保存角色权限</Button></Popconfirm>}
      </Space>},
      {key:'audit',label:'安全操作记录',children:<Table rowKey="id" scroll={{x:600}} loading={loading} dataSource={data?.events} columns={[
        {title:'时间',dataIndex:'createdAt',render:v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})},
        {title:'操作人',dataIndex:'actor',render:id=>data?.users.find(u=>u.id===id)?.username??id},
        {title:'操作',dataIndex:'action'},{title:'对象',dataIndex:'target'},
      ]}/>},
    ]}/>
    <Modal open={editing!==undefined} title={editing?'编辑账号':'新增账号'} forceRender confirmLoading={busy} onCancel={()=>setEditing(undefined)}
      onOk={async()=>{let v;try{v=await form.validateFields();}catch{return;}await run(async()=>{
        const body={...v,password:v.password||undefined,entityIds:v.role==='admin'?[]:v.entityIds??[]};
        if(editing) await client.put('/permissions/users/'+editing.id,body,config());else await client.post('/permissions/users',body,config());
        setEditing(undefined);
      });}}>
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item name="username" label="登录账号" rules={[{required:true},{pattern:/^[a-zA-Z0-9_.-]{3,64}$/,message:'请输入3至64位字母、数字或 ._-'}]}><Input disabled={!!editing}/></Form.Item>
        <Form.Item name="name" label="姓名" rules={[{required:true,whitespace:true}]}><Input maxLength={64}/></Form.Item>
        <Form.Item name="password" label={editing?'重置密码':'初始密码'} rules={[{required:!editing},{min:10,message:'至少10位'}]}><Input.Password autoComplete="new-password" placeholder={editing?'留空保留原密码':'至少10位'}/></Form.Item>
        <Form.Item name="role" label="角色" rules={[{required:true}]}><Select options={data?.roles.map(r=>({value:r.code,label:r.name}))}/></Form.Item>
        {selectedRole!=='admin'&&<Form.Item name="entityIds" label="授权主体"><Select mode="multiple" allowClear optionFilterProp="label" options={data?.entities.map(e=>({value:e.id,label:e.name}))}/></Form.Item>}
        <Form.Item name="status" label="账号状态"><Select options={[{value:'active',label:'启用'},{value:'disabled',label:'停用'}]}/></Form.Item>
      </Form>
    </Modal>
    <Modal open={!!preview} title={'权限预览 · '+(preview?.name??'')} footer={null} onCancel={()=>setPreview(null)}>
      {preview&&<><p><b>角色：</b>{roleName(preview.role)}</p><p><b>主体：</b>{scope(preview)}</p>
        <p><b>有效权限：</b>{preview.status!=='active'?'账号已停用':preview.role==='admin'?'全部管理和业务权限':roleKeys(preview.role)}</p></>}
    </Modal>
  </section>;
}
