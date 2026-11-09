import {createRequire} from 'module';const require=createRequire(import.meta.url);const {chromium}=require('playwright');
import game from './game.mjs';import wallet from './wallet.mjs';import pisti from './tavla.mjs';import {store,setUid} from './admin-stub.mjs';
const fns={'/api/game':game,'/api/wallet':wallet,'/api/tavla':pisti};
const b=await chromium.launch();const errs=[];
const c=await b.newContext({viewport:(process.argv[2]==='d'?{width:1280,height:720}:process.argv[2]==='l'?{width:844,height:390}:{width:390,height:800}),hasTouch:true,deviceScaleFactor:2});const p=await c.newPage();p.setDefaultTimeout(8000);
p.on('pageerror',e=>errs.push(e.message));
await p.exposeFunction('__all',()=>store);await p.exposeFunction('__set',(k,v,m)=>{if(v===undefined){delete store[k];return}store[k]=m?{...(store[k]||{}),...v}:v});
await p.route(/\/api\/(game|wallet|tavla)$/,async r=>{const path=new URL(r.request().url()).pathname;setUid('uAAAAAAAAAAAA');const res=await fns[path]({method:'POST',headers:{get:()=>''},json:async()=>JSON.parse(r.request().postData()||'{}')});await r.fulfill({status:res.status,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.route(/\/api\/(notify|turn|contacts|admin|account|pool)$/,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await p.addInitScript(`window.__UID='uAAAAAAAAAAAA';window.__NAME='Harun Kılınç'`);
await p.goto('http://localhost:8098/');await p.waitForTimeout(800);
await p.fill('#pPhone','0532 111 22 33');await p.check('#pTerms');await p.click('#pOk');await p.waitForTimeout(800);await p.click('#mCancel').catch(()=>{});await p.waitForTimeout(1500);await p.click('#eClose').catch(()=>{});
await p.click('[data-tab="games"]');await p.waitForTimeout(500);await p.click('[data-g="pub-tavla"]');await p.waitForTimeout(500);await p.click('#pubNew');await p.waitForTimeout(300);await p.click('[data-stake="0"]');await p.waitForTimeout(1200);
await p.screenshot({path:'/home/claude/tv'+(process.argv[2]||'')+'0.png'});
await p.click('#gStart');await p.waitForTimeout(1500);
await p.screenshot({path:'/home/claude/tv'+(process.argv[2]||'')+'1.png'});
const gid=Object.keys(store).find(k=>/^games\/[^/]+$/.test(k));
for(let k=0;k<12&&store[gid].status==='play';k++){
  for(let j=0;j<4;j++){if(!(await p.$('.tp.src, .bm.src')))break;await p.click('.tp.src, .bm.src',{timeout:2000}).catch(()=>{});await p.waitForTimeout(250);if(await p.$('.tp.tgt, .om.tgt')){if(k===1&&j===0)await p.screenshot({path:'/home/claude/tv'+(process.argv[2]||'')+'2.png'});await p.click('.tp.tgt, .om.tgt',{timeout:2000}).catch(()=>{});await p.waitForTimeout(250)}}
  await p.waitForTimeout(900);
}
await p.waitForTimeout(800);console.log('status',store[gid].status,JSON.stringify(store[gid].final),store[gid].log);
await p.screenshot({path:'/home/claude/tv'+(process.argv[2]||'')+'3.png'});
console.log('errors',errs.slice(0,5));await b.close();
