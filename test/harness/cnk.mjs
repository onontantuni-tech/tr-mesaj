import fn from './game.mjs';import {store,setUid} from './admin-stub.mjs';import * as O from '/home/claude/tr-mesaj/netlify/lib/okey.mjs';
const call=async(u,body)=>{setUid(u);return fn({method:'POST',json:async()=>body})};
store['groups/g']={members:['uA']};store['wallets/uA']={balance:1e6,adult:true,xp:99999};
let r=await call('uA',{action:'create',type:'okey',conv:'g:g',stake:10000,canak:true});console.log('create',r.body);const id=r.body.id;
console.log('start',(await call('uA',{action:'start',id})).body, store['games/'+id].canak);
let skipped=0,steps=0;
while(store['games/'+id].status==='play'&&steps++<300){const g=store['games/'+id];const u='uA';const h=store[`games/${id}/hands/${u}`].tiles;const ok=O.okeyOf(g.indicator);
 if(g.phase==='draw'){const pd=g.discards[(g.turn+3)%4];await call(u,{action:'draw',id,from:O.botChooseDraw(h,pd.length?pd.at(-1):null,ok)});continue}
 const fin=O.findFinish(h,ok);let t=O.botChooseDiscard(h,ok);if(fin){skipped++;t=h.find(x=>x!==fin.tile)??t}
 const rr=await call(u,{action:'discard',id,tile:t});if(rr.status!==200)throw new Error(JSON.stringify(rr.body))}
const g=store['games/'+id];console.log('status',g.status,'winner',g.winner,'skippedFinish',skipped,'canakPot',g.canakPot,'payout',JSON.stringify(g.payout));
