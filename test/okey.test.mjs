import * as O from "../netlify/lib/okey.mjs";
import assert from "node:assert";
const T=(c,n,copy=0)=>c*26+(n-1)*2+copy;
// gösterge kırmızı 5 -> okey kırmızı 6
const ind=T(0,5), okey=O.okeyOf(ind);
assert.deepStrictEqual(okey,{c:0,n:6});
assert.strictEqual(O.valueOf(T(0,6),okey),"W");
assert.deepStrictEqual(O.valueOf(104,okey),{c:0,n:6});
// seri el: sarı 1-2-3, mavi 7-8-9-10, 4'lü per 11, siyah 12-13-1
let h=[T(1,1),T(1,2),T(1,3), T(2,7),T(2,8),T(2,9),T(2,10), T(0,11),T(1,11),T(2,11),T(3,11)];
h.push(T(3,12),T(3,13),T(3,1));
assert.strictEqual(O.winKind(h,okey),"seri","12-13-1 dahil seri");
// 13-1-2 geçersiz
let bad=[T(1,1),T(1,2),T(1,3), T(2,7),T(2,8),T(2,9),T(2,10), T(0,11),T(1,11),T(2,11),T(3,11), T(3,13),T(3,1),T(3,2)];
assert.strictEqual(O.winKind(bad,okey),false,"13-1-2 olmaz");
// joker ile: sarı 1, joker, sarı 3
let j=[T(1,1),T(0,6),T(1,3), T(2,7),T(2,8),T(2,9),T(2,10), T(0,11),T(1,11),T(2,11),T(3,11), T(3,12),T(3,13),T(3,1)];
assert.strictEqual(O.winKind(j,okey),"seri","jokerli seri");
// iki joker + 13 (j,j,13)
let jj=[T(0,6),T(0,6,1),T(1,13), T(2,7),T(2,8),T(2,9),T(2,10), T(0,11),T(1,11),T(2,11),T(3,11), T(3,2),T(3,3),T(3,4)];
assert.strictEqual(O.winKind(jj,okey),"seri","j,j,13");
// sahte okey kırmızı 6 yerine geçer: kırmızı 4-5-[sahte=6]
let f=[T(0,4),T(0,5),104, T(2,7),T(2,8),T(2,9),T(2,10), T(0,11),T(1,11),T(2,11),T(3,11), T(3,12),T(3,13),T(3,1)];
assert.strictEqual(O.winKind(f,okey),"seri","sahte okey");
// çift: 7 çift
let p=[];for(const [c,n] of [[0,1],[1,2],[2,3],[3,4],[0,9],[1,10]])p.push(T(c,n),T(c,n,1));p.push(T(2,12),T(0,6));
assert.strictEqual(O.winKind(p,okey),"cift","çift + jokerle çift");
// rastgele dağıtım: 106 taş, gösterge sahte değil
for(let i=0;i<200;i++){const d=O.deal(i%4);const all=[d.indicator,...d.hands.flat(),...d.pile];assert.strictEqual(new Set(all).size,106);assert(!O.isFake(d.indicator));assert.strictEqual(d.hands[i%4].length,15);}
// findFinish
let h15=[...h,T(2,1)];const ff=O.findFinish(h15,okey);assert(ff&&ff.tile===T(2,1),"fazla taşı atınca biter");
// bot simülasyonu: 4 bot oynasın, oyun bitsin ya da deste tükensin, hatasız
let wins=0,draws=0;const t0=Date.now();
for(let g=0;g<300;g++){const d=O.deal(0);const hands=d.hands;const disc=[[],[],[],[]];let turn=0,phase='discard',done=false;
 while(!done){const hand=hands[turn];
  if(phase==='draw'){const prev=(turn+3)%4;const top=disc[prev].at(-1);const ch=O.botChooseDraw(hand,top,d.okey);if(ch==='left'&&top!=null)hand.push(disc[prev].pop());else{if(!d.pile.length){draws++;done=true;break}hand.push(d.pile.pop())}phase='discard'}
  const fin=O.findFinish(hand,d.okey);if(fin){wins++;done=true;break}
  const t=O.botChooseDiscard(hand,d.okey);hand.splice(hand.indexOf(t),1);disc[turn].push(t);turn=(turn+1)%4;phase='draw';}
}
console.log("tamam: testler geçti. 300 bot oyunu ->",wins,"bitti,",draws,"berabere,",Date.now()-t0,"ms");
