import fn from './game.mjs';import {store,setUid} from './admin-stub.mjs';import * as O from '/home/claude/tr-mesaj/netlify/lib/okey.mjs';
const call=async(u,body)=>{setUid(u);return fn({method:'POST',json:async()=>body})};
store['groups/grp1']={members:['uA','uB','uC']};
let r=await call('uA',{action:'create',type:'okey',conv:'g:grp1'});console.log('create',r);const id=r.body.id;
console.log('join B',(await call('uB',{action:'join',id})).body, 'join X',(await call('uX',{action:'join',id})).status);
console.log('start by B',(await call('uB',{action:'start',id})).status);
console.log('start',(await call('uA',{action:'start',id})).body);
let g=store['games/'+id];console.log('seats',g.seats.map(s=>s.bot?s.name:s.uid),'turn',g.turn,'phase',g.phase,'pile',g.pileCount,'counts',g.handCounts);
// play until over, humans play bot-like
let steps=0;
while(store['games/'+id].status==='play'&&steps<400){steps++;g=store['games/'+id];const seat=g.turn;const u=g.seats[seat].uid;const okey=O.okeyOf(g.indicator);
 const hand=store[`games/${id}/hands/${u}`].tiles;
 if(g.phase==='draw'){const pd=g.discards[(seat+3)%4];const top=pd.length?pd.at(-1):null;const ch=O.botChooseDraw(hand,top,okey);const rr=await call(u,{action:'draw',id,from:ch});if(rr.status!==200)throw new Error('draw '+JSON.stringify(rr));continue}
 const fin=O.findFinish(hand,okey);if(fin){const rr=await call(u,{action:'finish',id,tile:fin.tile});console.log('human finish',rr.body);break}
 // wrong-turn check once
 if(steps===3){const other=u==='uA'?'uB':'uA';console.log('wrong turn ->',(await call(other,{action:'discard',id,tile:0})).body)}
 if(steps===5){console.log('bad finish ->',(await call(u,{action:'finish',id,tile:hand[0]})).body)}
 const t=O.botChooseDiscard(hand,okey);const rr=await call(u,{action:'discard',id,tile:t});if(rr.status!==200)throw new Error('discard '+JSON.stringify(rr));}
g=store['games/'+id];console.log('status',g.status,'winner',g.winner,g.winKind,'log',g.log,'scores',g.scores,'steps',steps);
// integrity: all tiles accounted when over
const tiles=[g.indicator,...Object.values(g.discards).flat(),...store['gsecret/'+id].pile,...Object.values(store['gsecret/'+id].bots).flat(),...['uA','uB'].flatMap(u=>store[`games/${id}/hands/${u}`]?.tiles||[])];
console.log('tile count',tiles.length,'unique',new Set(tiles).size);
console.log('again',(await call('uA',{action:'again',id})).body, store['games/'+id].status, store['games/'+id].round);
// leave during play -> bot takes over
console.log('B leaves',(await call('uB',{action:'leave',id})).body, store['games/'+id].seats.map(s=>s.bot?s.name:s.uid), 'B hand doc', !!store[`games/${id}/hands/uB`]);
// poke when idle
const gg=store['games/'+id];gg.lastMoveAt=Date.now()-60000;console.log('poke',(await call('uC',{action:'poke',id})).body);
