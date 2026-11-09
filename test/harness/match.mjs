import dom from './domino.mjs';import pis from './pisti.mjs';import {store,setUid} from './admin-stub.mjs';import * as K from '/home/claude/tr-mesaj/netlify/lib/domino.mjs';import * as PK from '/home/claude/tr-mesaj/netlify/lib/pisti.mjs';
const call=async(fn,u,body)=>{setUid(u);return fn({method:'POST',json:async()=>body})};
store['groups/g1']={members:['uA','uB']};
for(const [fn,type] of [[dom,'domino'],[pis,'pisti']]){
 let r=await call(fn,'uA',{action:'create',type,conv:'g:g1',hands:3});const id=r.body.id;await call(fn,'uA',{action:'start',id});
 let steps=0,hands=new Set();
 while(store['games/'+id].status==='play'&&steps++<2000){const g=store['games/'+id];hands.add(g.handNo);const u='uA';if(g.seats[g.turn].uid!==u)throw new Error('turn '+g.turn);
  let rr;if(type==='domino'){const h=store[`games/${id}/hands/${u}`].tiles;const mv=K.botMove(g.chain,h,1);rr=mv?await call(fn,u,{action:'play',id,tile:mv.id,side:mv.side}):g.boneN?await call(fn,u,{action:'draw',id}):await call(fn,u,{action:'pass',id})}
  else{const h=store[`games/${id}/hands/${u}`].cards;rr=await call(fn,u,{action:'play',id,card:h[0]})}
  if(rr.status!==200)throw new Error(type+JSON.stringify(rr.body))}
 const g=store['games/'+id];console.log(type,g.status,'hands seen',[...hands],'matchPts',g.matchPts,'winner',g.winner,g.log,'prev',JSON.stringify(g.prevFinal).slice(0,80));
}
