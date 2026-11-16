import {useEffect,useState} from 'react';
import {Alert,Button,Modal,Select,Table,message} from 'antd';
import {SafetyOutlined,SaveOutlined} from '@ant-design/icons';
import EntityAccessGuard from '../components/EntityAccessGuard';
import client from '../api/client';
import {getEntityAccessToken} from '../api/entities';
import type {FeishuFormConfig} from './userMigrationData';

type Entry={label:string;entityId?:number};
const headers=()=>({'X-Entity-Access-Token':getEntityAccessToken()||''});
function Bindings({config,close}:{config:FeishuFormConfig;close:()=>void}){
  const [rows,setRows]=useState<Entry[]>([]),[entities,setEntities]=useState<{id:number;name:string}[]>([]);
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const {appToken,tableId,viewId}=config;
  useEffect(()=>{
    const controller=new AbortController();
    setReady(false);setError('');
    client.get('/migration/operator-source',{params:{appToken,tableId,viewId},headers:headers(),signal:controller.signal})
      .then(r=>{if(!controller.signal.aborted){setRows(r.data.bindings);setEntities(r.data.entities);setReady(true);}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.response?.data?.error||'主体映射读取失败');});
    return ()=>controller.abort();
  },[appToken,tableId,viewId]);
  async function save(){
    setBusy(true);
    try {await client.put('/migration/operator-source',{source:{appToken,tableId,viewId},bindings:rows.filter(r=>r.entityId!=null)},{headers:headers()});
      message.success('运营迁移范围已更新');close();
    }catch(e:any){setError(e.response?.data?.error||'保存失败');}finally{setBusy(false);}
  }
  return <>{error&&<Alert type="error" showIcon message={error}/>}
    <Table rowKey="label" size="small" dataSource={rows} loading={!error&&!ready} pagination={{pageSize:8}} columns={[
      {title:'源表主体选项',dataIndex:'label'},
      {title:'系统主体',render:(_,row)=><Select style={{width:'100%'}} aria-label={row.label} allowClear showSearch optionFilterProp="label"
        placeholder="不对运营开放" value={row.entityId} options={entities.map(e=>({label:e.name,value:e.id}))}
        onChange={entityId=>setRows(list=>list.map(r=>r.label===row.label?{...r,entityId}:r))}/>},
    ]}/>
    <Button type="primary" icon={<SaveOutlined/>} disabled={!ready} loading={busy} onClick={save}>保存运营范围</Button>
  </>;
}
export default function MigrationBindings({config}:{config:FeishuFormConfig}){
  const [open,setOpen]=useState(false);
  return <><Button icon={<SafetyOutlined/>} disabled={!config.appToken||!config.tableId} onClick={()=>setOpen(true)}>运营主体映射</Button>
    <Modal title="运营主体映射" width={640} open={open} destroyOnHidden footer={null} onCancel={()=>setOpen(false)}>
      <EntityAccessGuard title="运营主体映射"><Bindings config={config} close={()=>setOpen(false)}/></EntityAccessGuard>
    </Modal></>;
}
