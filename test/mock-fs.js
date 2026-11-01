const all=()=>window.__all();
export const initializeFirestore=()=>({});
export const persistentLocalCache=()=>({});export const persistentMultipleTabManager=()=>({});
let n=0;const rid=()=>Date.now().toString(36)+(n++)+Math.random().toString(36).slice(2,8);
export function collection(fs,...p){return{kind:'col',path:p.join('/')}}
export function doc(a,...p){if(a&&a.kind==='col'){return{kind:'doc',path:a.path+'/'+(p[0]||rid()),get id(){return this.path.split('/').pop()}}}return{kind:'doc',path:p.join('/'),get id(){return this.path.split('/').pop()}}}
export function where(f,op,v){return{f,op,v}}
export function query(c,...w){return{kind:'q',path:c.path,w}}
function snapDoc(path,v){return{id:path.split('/').pop(),exists:()=>v!==undefined,data:()=>v,metadata:{hasPendingWrites:false}}}
export async function getDoc(r){const st=await all();return snapDoc(r.path,st[r.path])}
export async function setDoc(r,d,o){d=JSON.parse(JSON.stringify(d));await window.__set(r.path,d,!!(o&&o.merge))}
function match(d,ws){return ws.every(({f,op,v})=>op==='=='?d[f]===v:op==='array-contains'?Array.isArray(d[f])&&d[f].includes(v):true)}
async function runQ(q){const st=await all();const depth=q.path.split('/').length+1;
 const docs=Object.entries(st).filter(([k])=>k.startsWith(q.path+'/')&&k.split('/').length===depth).filter(([k,v])=>match(v,q.w||[])).map(([k,v])=>snapDoc(k,v));
 return{docs,docChanges:()=>[]}}
export function onSnapshot(r,cb,err){let last='';const run=async()=>{try{let s;if(r.kind==='doc')s=await getDoc(r);else s=await runQ(r);const key=JSON.stringify(r.kind==='doc'?s.data():s.docs.map(d=>[d.id,d.data()]));if(key!==last){last=key;cb(s)}}catch(e){err&&err(e)}};run();const t=setInterval(run,300);return()=>clearInterval(t)}
