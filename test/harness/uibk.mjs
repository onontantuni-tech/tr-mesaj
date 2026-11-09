import {createRequire} from 'module';const require=createRequire(import.meta.url);const {chromium}=require('playwright');
import game from './game.mjs';import wallet from './wallet.mjs';import pisti from './batak.mjs';import {store,setUid} from './admin-stub.mjs';
const fns={'/api/game':game,'/api/wallet':wallet,'/api/batak':pisti};
const b=await chromium.launch();const errs=[];
const c=await b.newContext({viewport:{width:844,height:390},hasTouch:true,deviceScaleFactor:2});const p=await c.newPage();p.setDefaultTimeout(8000);
p.on('pageerror',e=>errs.push(e.message));
await p.exposeFunction('__all',()=>store);await p.exposeFunction('__set',(k,v,m)=>{if(v===undefined){delete store[k];return}store[k]=m?{...(store[k]||{}),...v}:v});
await p.route(/\/api\/(game|wallet|batak)$/,async r=>{const path=new URL(r.request().url()).pathname;setUid('uAAAAAAAAAAAA');const res=await fns[path]({method:'POST',headers:{get:()=>''},json:async()=>JSON.parse(r.request().postData()||'{}')});await r.fulfill({status:res.status,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.route(/\/api\/(notify|turn|contacts|admin|account|pool)$/,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await p.addInitScript(`window.__UID='uAAAAAAAAAAAA';window.__NAME='Harun Kılınç'`);
await p.goto('http://localhost:8098/');await p.waitForTimeout(800);
await p.fill('#pPhone','0532 111 22 33');await p.check('#pTerms');await p.click('#pOk');await p.waitForTimeout(800);await p.click('#mCancel').catch(()=>{});await p.waitForTimeout(1500);await p.click('#eClose').catch(()=>{});
await p.click('[data-tab="games"]');await p.waitForTimeout(500);await p.click('[data-g="pub-batak"]');await p.waitForTimeout(500);await p.click('#pubNew');await p.waitForTimeout(300);await p.click('[data-stake="0"]');await p.waitForTimeout(1200);
await p.screenshot({path:'/home/claude/bk0.png'});
await p.click('#gStart');await p.waitForTimeout(1500);
await p.screenshot({path:'/home/claude/bk1.png'});
const gid=Object.keys(store).find(k=>/^games\/[^/]+$/.test(k));
for(let k=0;k<60&&store[gid].status==='play';k++){
  const bb=await p.$('[data-bid]');const tb=await p.$('[data-trump]');const cc=await p.$('.bkhand .pcard.ok');
  if(bb){const bs=await p.$$('[data-bid]');await bs[0].click().catch(()=>{});}else if(tb){await tb.click().catch(()=>{})}else if(cc){await cc.click().catch(()=>{})}
  await p.waitForTimeout(700);if(k===6)await p.screenshot({path:'/home/claude/bk2.png'});if(!globalThis.__tk&&await p.$('.bktake')){globalThis.__tk=1;await p.waitForTimeout(300);await p.screenshot({path:'/home/claude/bktk.png'})}
}
await p.waitForTimeout(800);console.log('status',store[gid].status,JSON.stringify(store[gid].final),store[gid].log);
await p.screenshot({path:'/home/claude/bk3.png'});
console.log('errors',errs.slice(0,5));await b.close();
