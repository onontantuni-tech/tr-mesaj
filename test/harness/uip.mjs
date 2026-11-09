import {createRequire} from 'module';const require=createRequire(import.meta.url);const {chromium}=require('playwright');
import game from './game.mjs';import wallet from './wallet.mjs';import pisti from './pisti.mjs';import {store,setUid} from './admin-stub.mjs';
const fns={'/api/game':game,'/api/wallet':wallet,'/api/pisti':pisti};
const b=await chromium.launch();const errs=[];
const c=await b.newContext({viewport:{width:390,height:800},hasTouch:true,deviceScaleFactor:2});const p=await c.newPage();p.setDefaultTimeout(8000);
p.on('pageerror',e=>errs.push(e.message));
await p.exposeFunction('__all',()=>store);await p.exposeFunction('__set',(k,v,m)=>{if(v===undefined){delete store[k];return}store[k]=m?{...(store[k]||{}),...v}:v});
await p.route(/\/api\/(game|wallet|pisti)$/,async r=>{const path=new URL(r.request().url()).pathname;setUid('uAAAAAAAAAAAA');const res=await fns[path]({method:'POST',headers:{get:()=>''},json:async()=>JSON.parse(r.request().postData()||'{}')});await r.fulfill({status:res.status,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.route(/\/api\/(notify|turn|contacts|admin|account|pool)$/,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await p.addInitScript(`window.__UID='uAAAAAAAAAAAA';window.__NAME='Harun Kılınç'`);
await p.goto('http://localhost:8098/');await p.waitForTimeout(800);
await p.fill('#pPhone','0532 111 22 33');await p.check('#pTerms');await p.click('#pOk');await p.waitForTimeout(800);await p.click('#mCancel').catch(()=>{});await p.waitForTimeout(1500);await p.click('#eClose').catch(()=>{});
await p.click('[data-tab="games"]');await p.waitForTimeout(500);await p.click('[data-g="pub-pisti"]');await p.waitForTimeout(500);await p.click('#pubNew');await p.waitForTimeout(300);await p.click('[data-stake="0"]');await p.waitForTimeout(1200);
await p.screenshot({path:'/home/claude/pi0.png'});
await p.click('#gStart');await p.waitForTimeout(1500);
await p.screenshot({path:'/home/claude/pi1.png'});
const gid=Object.keys(store).find(k=>/^games\/[^/]+$/.test(k));
for(let k=0;k<40&&store[gid].status==='play';k++){
  const can=await p.$('.phand.me.can .pcard[data-c]');if(can){await can.click();await p.waitForTimeout(700)}else await p.waitForTimeout(400);
  if(k===3)await p.screenshot({path:'/home/claude/pi2.png'});
}
await p.waitForTimeout(800);console.log('status',store[gid].status,JSON.stringify(store[gid].final),store[gid].log);
await p.screenshot({path:'/home/claude/pi3.png'});
console.log('errors',errs.slice(0,5));await b.close();
