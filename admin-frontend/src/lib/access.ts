import type {UserInfo} from '../api/auth';
import {useAuthStore} from '../store/authStore';

const pages:Record<string,string>={'/migration':'migration','/warnings':'warnings','/entities':'entities','/customers':'customers','/consumption':'consumption','/recharges':'recharges','/workbench':'workbench'};
export function canPage(user:UserInfo|null,path:string) {
  return !!user && (user.role==='admin' || path==='/' || !!user.permissions?.includes(pages[path]));
}
export function useAccess() {
  const user=useAuthStore(s=>s.user);
  return {admin:user?.role==='admin',can:(key:string)=>user?.role==='admin'||!!user?.permissions?.includes(key)};
}
