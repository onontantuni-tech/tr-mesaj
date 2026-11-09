import {createRequire} from 'module';const require=createRequire(import.meta.url);const {chromium}=require('playwright');
import game from './game.mjs';import wallet from './wallet.mjs';import pool from './pool.mjs';import {store,setUid} from './admin-stub.mjs';
const fns={'/api/game':game,'/api/wallet':wallet,'/api/pool':pool};
const vp=process.argv[2]==='p'?{width:930,height:440}:process.argv[2]==='d'?{width:1280,height:780}:process.argv[2]==='l'?{width:844,height:390}:{width:390,height:800};const tag=process.argv[2]||'m';
const b=await chromium.launch();const errs=[];
const c=await b.newContext({viewport:vp,hasTouch:true});const p=await c.newPage();p.setDefaultTimeout(8000);
p.on('pageerror',e=>errs.push(e.message));
await p.exposeFunction('__all',()=>store);await p.exposeFunction('__set',(k,v,m)=>{if(v===undefined){delete store[k];return}store[k]=m?{...(store[k]||{}),...v}:v});
await p.route(/\/api\/(game|wallet|pool)$/,async r=>{const path=new URL(r.request().url()).pathname;setUid('uAAAAAAAAAAAA');const res=await fns[path]({method:'POST',headers:{get:()=>''},json:async()=>JSON.parse(r.request().postData()||'{}')});await r.fulfill({status:res.status,contentType:'application/json',body:JSON.stringify(res.body)})});
await p.route(/\/api\/(notify|turn|contacts|admin|account)$/,r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await p.addInitScript(`window.__UID='uAAAAAAAAAAAA';window.__NAME='Harun Kılınç'`);
await p.goto('http://localhost:8098/');await p.waitForTimeout(800);
await p.fill('#pPhone','0532 111 22 33');await p.check('#pTerms');await p.click('#pOk');await p.waitForTimeout(800);await p.click('#mCancel').catch(()=>{});await p.waitForTimeout(1500);await p.click('#eClose').catch(()=>{});
await p.click('[data-tab="games"]');await p.waitForTimeout(500);await p.click('[data-g="pub-okey"]');await p.waitForTimeout(500);await p.click('#pubNew');await p.waitForTimeout(300);await p.click('[data-stake="0"]');await p.waitForTimeout(1200);
await p.click('#gStart');await p.waitForTimeout(2500);if(await p.isVisible('#rotHint'))await p.screenshot({path:'/home/claude/o_rot.png'}),await p.click('#rotSkip');
await p.screenshot({path:`/home/claude/o_${tag}1.png`});
await p.click('#gSortRun');await p.waitForTimeout(500);await p.screenshot({path:`/home/claude/o_${tag}2.png`});
const gid=Object.keys(store).find(k=>/^games\/[^/]+$/.test(k));store[gid].canak=true;store[gid].canakPot=12500;
const waitMine=async(ph)=>{for(let i=0;i<40;i++){const g=store[gid];if(g.turn===0&&g.phase===ph)return true;await p.waitForTimeout(300)}return false};
console.log('valid groups highlighted:',await p.$$eval('.slot.okg',x=>x.length));
for(let round=0;round<2;round++){
 if(!await waitMine('draw')){console.log('not my draw',store[gid].turn,store[gid].phase);break}
 const before=store[gid+'/hands/uAAAAAAAAAAAA']?.tiles?.length;
 if(round===0){const pb=await (await p.$('#gPile')).boundingBox();const sl=await (await p.$('#gRack .slot[data-slot="25"]')).boundingBox();
   await p.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await p.mouse.down();await p.mouse.move(pb.x+30,pb.y+60,{steps:5});await p.mouse.move(sl.x+sl.width/2,sl.y+sl.height/2,{steps:10});
   await p.screenshot({path:'/home/claude/ok_drag.png'});await p.mouse.up();}
 else{const pb=await (await p.$('#gPile')).boundingBox();await p.mouse.click(pb.x+pb.width/2,pb.y+pb.height/2)}
 await p.waitForTimeout(1500);
 console.log('round',round,'phase',store[gid].phase,'hand',before,'->',store[gid+'/hands/uAAAAAAAAAAAA']?.tiles?.length,'slot25 filled:',await p.$eval('#gRack .slot[data-slot="25"]',x=>!!x.querySelector('.tile')));
 await p.screenshot({path:'/home/claude/ok_r'+round+'.png'});
 // discard by double tap
 const t=await p.$('#gRack .slot .tile');const bb=await t.boundingBox();await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await p.waitForTimeout(100);await p.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);await p.waitForTimeout(1500);
}
console.log('errors',errs.slice(0,5));await b.close();
