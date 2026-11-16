// Only the original administrator adopts unscoped records from older installations.
export function accountCacheKey(base:string) {
  const user=JSON.parse(localStorage.getItem('user')||'null');
  const key=base+':account:'+(user?.id??'anon');
  if(user?.id===1 && user?.role==='admin' && localStorage.getItem(key)===null){
    const old=localStorage.getItem(base);
    if(old!==null){localStorage.setItem(key,old);localStorage.removeItem(base);}
  }
  return key;
}
