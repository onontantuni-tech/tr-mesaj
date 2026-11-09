export const store={};
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function chk(v,p){if(v===undefined)throw new Error('undefined at '+p);if(Array.isArray(v)){v.forEach((x,i)=>{if(Array.isArray(x))throw new Error('nested array at '+p);chk(x,p+'['+i+']')})}else if(v&&typeof v==='object')for(const k in v)chk(v[k],p+'.'+k)}
let nid=0;
function docRef(path){return{path,firestore:db,get id(){return path.split('/').pop()},
 async get(){const v=store[path];return{exists:v!==undefined,ref:docRef(path),id:path.split('/').pop(),data:()=>clone(v)}},
 async set(d){chk(d,path);store[path]=clone(d)},
 async update(d){store[path]={...store[path],...clone(d)}},
 async delete(){delete store[path]}}}
function Q(c,filters,lim){const run=async()=>{let docs=Object.entries(store).filter(([k,d])=>k.startsWith(c+'/')&&k.split('/').length===c.split('/').length+1&&filters.every(([f,op,v])=>op==='array-contains'?Array.isArray(d[f])&&d[f].includes(v):op==='>='?d[f]>=v:op==='>'?d[f]>v:op==='<'?d[f]<v:op==='<='?d[f]<=v:d[f]===v));if(lim)docs=docs.slice(0,lim);const ds=docs.map(([k,d])=>({id:k.split('/').pop(),ref:docRef(k),data:()=>clone(d)}));return{docs:ds,empty:!ds.length,size:ds.length}};
 return{get:run,where:(f,op,v)=>Q(c,[...filters,[f,op,v]],lim),limit:(n)=>Q(c,filters,n)}}
export const db={doc:docRef,collection:(c)=>({get:async()=>({docs:Object.entries(store).filter(([k])=>k.startsWith(c+'/')&&k.split('/').length===c.split('/').length+1).map(([k,d])=>({id:k.split('/').pop(),ref:docRef(k),data:()=>clone(d)}))}),doc:(id)=>docRef(c+'/'+(id||('gid'+(nid++)+'abcdefghij'))),
 where:(f,op,v)=>Q(c,[[f,op,v]],0), limit:(n)=>Q(c,[],n), add:async(d)=>{const r=docRef(c+'/'+('add'+(nid++)+'abcdefghij'));await r.set(d);return r},
 orderBy:(f,dir)=>({limit:(n)=>({get:async()=>({docs:Object.entries(store).filter(([k])=>k.startsWith(c+'/')&&k.split('/').length===c.split('/').length+1).sort((a,b)=>(b[1][f]||0)-(a[1][f]||0)).slice(0,n).map(([k,d])=>({id:k.split('/').pop(),data:()=>clone(d)}))})})}) }),
 batch(){const ops=[];return{delete:r=>ops.push(()=>r.delete()),update:(r,d)=>ops.push(()=>r.update(d)),set:(r,d)=>ops.push(()=>r.set(d)),commit:async()=>{for(const o of ops)await o()}}},
 async runTransaction(fn){const writes=[];const tx={get:r=>r.get(),set:(r,d,o)=>{if(o&&o.merge){writes.push(['merge',r.path,d]);return}chk(d,r.path);writes.push(['set',r.path,clone(d)])},update:(r,d)=>{writes.push(['upd',r.path,clone(d)])},delete:(r)=>writes.push(['del',r.path])};const res=await fn(tx);for(const [k,p,d] of writes){if(k==='merge'){const cur=store[p]||{};for(const [kk,vv] of Object.entries(d)){if(vv&&vv.constructor&&vv.constructor.name==='NumericIncrementTransform')cur[kk]=(cur[kk]||0)+vv.operand;else cur[kk]=vv}store[p]=cur}else if(k==='set')store[p]=d;else if(k==='upd')store[p]={...store[p],...d};else delete store[p]}return res}};
export let currentUid='uA';export const setUid=u=>{currentUid=u};
export const deletedUsers=[];export const admin=()=>({db,auth:{deleteUser:async u=>deletedUsers.push(u)},messaging:{sendEachForMulticast:async()=>({successCount:0})}});
export const json=(status,body)=>({status,body});
export const requireUser=async()=>currentUid;
export const SITE="";
