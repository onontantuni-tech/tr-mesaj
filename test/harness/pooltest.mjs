import * as P from '/home/claude/tr-mesaj/netlify/lib/pool.mjs';
let wins=[0,0],shotsTot=0,t0=Date.now();
for(let g=0;g<30;g++){
  const st={balls:P.rack(),groups:null,turn:0,ballInHand:"kitchen",broken:false};
  let w=null,n=0;
  while(w==null&&n<300){
    const seat=st.turn;const sh=P.botShot(st,seat,Math.random,seat===0?2:0);
    let balls=st.balls;if(sh.cue)balls=balls.filter(b=>b.i!==0).concat([{i:0,...sh.cue}]);
    const res=P.simulate(balls,sh.dir,sh.power);
    const r=P.applyShot(st,seat,res,balls);n++;
    if(r.winner!=null)w=r.winner;
  }
  if(w!=null)wins[w]++;shotsTot+=n;
}
console.log('wins skill2 vs skill0',wins,'avg shots',shotsTot/30,'ms/game',(Date.now()-t0)/30);
// determinism check
const b=P.rack(()=>0.3);const r1=P.simulate(b,{x:1,y:0.01},1),r2=P.simulate(b,{x:1,y:0.01},1);console.log('det',JSON.stringify(r1.balls)===JSON.stringify(r2.balls),'steps',r1.steps,'pocketed',r1.pocketed);
