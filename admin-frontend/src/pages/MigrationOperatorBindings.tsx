import {useEffect,useState} from 'react';
import {Button,Modal,Select,Space,Table,message} from 'antd';
import {LinkOutlined} from '@ant-design/icons';
import client from '../api/client';

type Entry={label:string;entityId?:number};
export default function MigrationOperatorBindings(){
  const [open,setOpen]=useState(false),[rows,setRows]=useState<Entry[]>([]);
  const [entities,setEntities]=useState<{id:number;name:string}[]>([]),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!open)return;setBusy(true);
    client.get('/migration/operator-source/mappings').then(r=>{
      const current=new Map<string,number>(r.data.bindings.map((b:Entry)=>[b.label,b.entityId!]));
      setRows(r.data.labels.map((label:string)=>({label,entityId:current.get(label)})));
      setEntities(r.data.entities);
    }).catch(e=>message.error(e.response?.data?.error||'匹配选项加载失败')).finally(()=>setBusy(false));
  },[open]);
  const save=async(row:Entry)=>{
    if(row.entityId==null)return message.warning('请选择系统主体');
    setBusy(true);try{await client.put('/migration/operator-source/mappings',{label:row.label,entityId:row.entityId});
      message.success('主体匹配已保存');setOpen(false);
    }catch(e:any){message.error(e.response?.data?.error||'保存失败');}finally{setBusy(false);}
  };
  return <><Button icon={<LinkOutlined/>} onClick={()=>setOpen(true)}>匹配迁移源表</Button>
    <Modal title="匹配迁移源表" open={open} onCancel={()=>setOpen(false)} footer={null} width={680} destroyOnHidden>
      <Table<Entry> rowKey="label" size="small" loading={busy} dataSource={rows} pagination={{pageSize:8}} columns={[
        {title:'源表主体选项',dataIndex:'label'},
        {title:'系统主体',render:(_,row)=><Space.Compact style={{width:'100%'}}>
          <Select aria-label={'匹配 '+row.label} showSearch optionFilterProp="label" style={{width:'100%'}} placeholder="选择已授权主体"
            value={row.entityId} options={entities.map(e=>({value:e.id,label:e.name}))}
            onChange={entityId=>setRows(list=>list.map(item=>item.label===row.label?{...item,entityId}:item))}/>
          <Button disabled={row.entityId==null} onClick={()=>void save(row)}>保存</Button>
        </Space.Compact>},
      ]}/>
    </Modal></>;
}
