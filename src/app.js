import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import * as P from "../netlify/lib/pool.mjs";
import { hasBad, clean as cleanText } from "../netlify/lib/filter.mjs";
import { getMessaging, getToken, isSupported as messagingSupported } from "firebase/messaging";
const VAPID_KEY="BNM0muk8JDXqc6KXABvndnLVHQHpYG-EKDet1qC6zkJq21tbM1P3y6sFlms3sSobLPmGBVkh1sbNQoZKo0s5N5w";

const firebaseConfig = {
  apiKey: "AIzaSyCjT6jaye-XKeBVI-GI_E-qpyAa_w9XzCo",
  authDomain: "trtr-f0f6d.firebaseapp.com",
  projectId: "trtr-f0f6d",
  storageBucket: "trtr-f0f6d.firebasestorage.app",
  messagingSenderId: "676722970002",
  appId: "1:676722970002:web:93b9e98f8bfff1e3ee054b"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let fs;
try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { fs = initializeFirestore(app, {}); }

const COLORS=["#D81E2A","#7B61FF","#00A884","#F59E0B","#0EA5E9","#EC4899","#14B8A6","#8B5CF6","#EF6C00"];
const EMOJI="😀😂🥹😍😘😎🤔😴😭😡👍👏🙏💪🔥❤️🎉✨☕🍕⚽🇹🇷🌙⭐😅🙌👀💯🤝😇🥳😢".match(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu);
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtCode=c=>c?String(c).replace(/^(\d{3})(\d{3})$/,"$1 $2"):"";
const CHUNK=600*1024;           // şifreli medya parça boyutu (bayt)
const MAX_VOICE_SEC=180;
const MAX_GROUP=50;

let dark=false;try{dark=localStorage.getItem("tr-dark")==="1"}catch(e){}
document.body.classList.toggle("dark",dark);

/* ---------- state ---------- */
// Sohbet kimliği (conv): birebir için karşı tarafın uid'si, grup için "g:"+gid
let me=null,meUser=null;
let users={};
let groups={};       // gid -> {name, members, admins, createdBy}
let raw=[];          // şifreli mesaj belgeleri
let plain={};        // msg id -> içerik nesnesi | null
let msgKey={};       // msg id -> içeriği çözen CryptoKey
let reads={};        // "okuyan_conv" -> zaman
let statuses={};
let contacts=[];
let friends={};
let vipU={};
let blocked={};       // engellediğim kişiler
let myBan=null;       // {until, reason} askıya alındıysam         // uid -> VIP bitiş zamanı (badges/{uid})      // karşı uid -> {id,status,from,to,at}
let pending=[];
let cur=null,tabNow="chats",query_="";
let ready=false;
let myPhone="";
let unsubs=[];
const isGroupConv=c=>typeof c==="string"&&c.startsWith("g:");
const gidOf=c=>c.slice(2);

/* ---------- crypto ---------- */
const enc=s=>new TextEncoder().encode(s);
const dec=b=>new TextDecoder().decode(b);
const b64=buf=>{const a=buf instanceof Uint8Array?buf:new Uint8Array(buf);let s="";for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const EC={name:"ECDH",namedCurve:"P-256"};
let myPriv=null,myPub=null;
const keyCache={};
const privRef=()=>doc(fs,"private",me,"data","main");
async function initKeys(){
  const snap=await getDoc(privRef());
  let k=snap.exists()?snap.data():{};
  if(typeof k.phone==="string")myPhone=k.phone;
  if(!k.priv||!k.pub){
    const kp=await crypto.subtle.generateKey(EC,true,["deriveKey"]);
    const priv=await crypto.subtle.exportKey("jwk",kp.privateKey),pub=await crypto.subtle.exportKey("jwk",kp.publicKey);
    k={...k,priv,pub:{x:pub.x,y:pub.y}};
    await setDoc(privRef(),{priv,pub:{x:pub.x,y:pub.y}},{merge:true});
  }
  const priv={...k.priv};delete priv.key_ops;
  myPriv=await crypto.subtle.importKey("jwk",priv,EC,false,["deriveKey"]);
  myPub={x:k.pub.x,y:k.pub.y};
}
function validPub(p){return p&&typeof p.x==="string"&&typeof p.y==="string"&&p.x.length<100&&p.y.length<100}
function pubOf(uid){return uid===me?myPub:users[uid]?.pub}
function keyFor(uid){
  const p=pubOf(uid);if(!validPub(p)||!myPriv)return Promise.resolve(null);
  const id=uid+":"+p.x+":"+p.y;
  if(!keyCache[id])keyCache[id]=(async()=>{
    const pk=await crypto.subtle.importKey("jwk",{kty:"EC",crv:"P-256",x:p.x,y:p.y,ext:true},EC,false,[]);
    return crypto.subtle.deriveKey({name:"ECDH",public:pk},myPriv,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  })().catch(()=>null);
  return keyCache[id];
}
async function aesEnc(key,data,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt(aad?{name:"AES-GCM",iv,additionalData:aad}:{name:"AES-GCM",iv},key,data);return{iv,ct:new Uint8Array(ct)}}
async function aesDec(key,iv,ct,aad){return new Uint8Array(await crypto.subtle.decrypt(aad?{name:"AES-GCM",iv,additionalData:aad}:{name:"AES-GCM",iv},key,ct))}
const aadOf=(from,to,at)=>enc(from+"|"+to+"|"+at);
// içerik: eski mesajlar düz metin, yenileri "\u0001"+JSON
const packContent=c=>c.t==="text"?c.text:"\u0001"+JSON.stringify(c);
function unpackContent(s){if(s.charCodeAt(0)===1){try{const o=JSON.parse(s.slice(1));if(o&&typeof o.t==="string")return o}catch(e){}return{t:"text",text:"[desteklenmeyen mesaj]"}}return{t:"text",text:s}}

async function decryptMsg(m){
  try{
    let key,aad;
    if(m.gid){
      const w=m.keys&&m.keys[me];if(!w)return null;
      const wk=await keyFor(m.from);if(!wk)return null;
      const rawKey=await aesDec(wk,unb64(w.iv),unb64(w.k),enc(m.gid+"|"+m.at));
      key=await crypto.subtle.importKey("raw",rawKey,"AES-GCM",false,["encrypt","decrypt"]);
      aad=aadOf(m.from,"g:"+m.gid,m.at);
    }else{
      key=await keyFor(m.from===me?m.to:m.from);if(!key)return null;
      aad=aadOf(m.from,m.to,m.at);
    }
    const pt=await aesDec(key,unb64(m.iv),unb64(m.ct),aad);
    msgKey[m.id]=key;
    return unpackContent(dec(pt));
  }catch(e){return null}
}
function keyStamp(m){const o=m.gid?m.from:(m.from===me?m.to:m.from);return(pubOf(o)?.x||"")+(myPriv?"1":"0")}
let decBusy=false,decAgain=false;
async function decryptAll(){
  if(decBusy){decAgain=true;return}decBusy=true;
  do{decAgain=false;
    const todo=raw.filter(m=>!(m.id in plain)||(plain[m.id]===null&&m._k!==keyStamp(m)));
    if(todo.length){await Promise.all(todo.map(async m=>{m._k=keyStamp(m);plain[m.id]=await decryptMsg(m)}));renderAll()}
  }while(decAgain);
  decBusy=false;
}

/* ---------- gönderim: anahtar hazırlama ---------- */
// Birebir: ortak anahtar. Grup: rastgele içerik anahtarı, her üyeye ayrı ayrı sarılır.
async function prepareSend(conv,at){
  if(isGroupConv(conv)){
    const gid=gidOf(conv),g=groups[gid];if(!g)throw{code:"nogroup"};
    const rawKey=crypto.getRandomValues(new Uint8Array(32));
    const key=await crypto.subtle.importKey("raw",rawKey,"AES-GCM",false,["encrypt","decrypt"]);
    const keys={};
    for(const uid of g.members){
      const wk=await keyFor(uid);if(!wk)continue;
      const w=await aesEnc(wk,rawKey,enc(gid+"|"+at));
      keys[uid]={iv:b64(w.iv),k:b64(w.ct)};
    }
    if(!keys[me])throw{code:"nokey"};
    return{key,aad:aadOf(me,"g:"+gid,at),base:{from:me,gid,members:[...g.members],keys,at,v:2}};
  }
  const key=await keyFor(conv);if(!key)throw{code:"nokey"};
  return{key,aad:aadOf(me,conv,at),base:{from:me,to:conv,members:[me,conv],at,v:2}};
}
async function sendContent(conv,content,{blob,mime,meta}={}){
  const at=Date.now();
  const ref=doc(collection(fs,"msgs"));
  const pv={id:ref.id,from:me,at,conv,content:{...content,_local:blob?URL.createObjectURL(blob):null},pending:true};
  pending.push(pv);renderMsgs();renderChats();
  try{
    const {key,aad,base}=await prepareSend(conv,at);
    let c=content;
    if(blob){
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const {iv,ct}=await aesEnc(key,bytes);
      const bid=ref.id,n=Math.ceil(ct.length/CHUNK);
      for(let i=0;i<n;i++){
        await setDoc(doc(fs,"blobs",bid+"_"+i),{from:me,members:base.members,i,n,d:b64(ct.subarray(i*CHUNK,(i+1)*CHUNK))});
      }
      c={...content,bid,n,iv:b64(iv),mime,size:bytes.length,...(meta||{})};
    }
    const {iv,ct}=await aesEnc(key,enc(packContent(c)),aad);
    plain[ref.id]={...c};msgKey[ref.id]=key;
    if(blob)mediaUrl[ref.id]=Promise.resolve(pv.content._local);
    await setDoc(ref,{...base,iv:b64(iv),ct:b64(ct)});
    callApi("/api/notify",{id:ref.id}).catch(()=>{});
    if(!isGroupConv(conv)&&!contacts.includes(conv))saveContact(conv);
    pending=pending.filter(x=>x!==pv);
    renderMsgs();renderChats();
    return true;
  }catch(err){
    delete plain[ref.id];
    pending=pending.filter(x=>x!==pv);renderMsgs();renderChats();
    toast(err&&err.code==="nokey"?"Şifreleme anahtarı hazır değil, biraz sonra tekrar dene":"Gönderilemedi, internetini kontrol et");
    return false;
  }
}

/* ---------- medya çözme ---------- */
const mediaUrl={};
function loadMedia(id){
  if(mediaUrl[id])return mediaUrl[id];
  const c=plain[id],key=msgKey[id];
  if(!c||!key||!c.bid)return Promise.resolve(null);
  mediaUrl[id]=(async()=>{
    const parts=[];
    for(let i=0;i<c.n;i++){
      const s=await getDoc(doc(fs,"blobs",c.bid+"_"+i));
      if(!s.exists())throw new Error("parça yok");
      parts.push(unb64(s.data().d));
    }
    const all=new Uint8Array(parts.reduce((a,p)=>a+p.length,0));let o=0;parts.forEach(p=>{all.set(p,o);o+=p.length});
    const pt=await aesDec(key,unb64(c.iv),all);
    return URL.createObjectURL(new Blob([pt],{type:c.mime||"application/octet-stream"}));
  })().catch(()=>{delete mediaUrl[id];return null});
  return mediaUrl[id];
}
function hydrateMedia(){
  document.querySelectorAll("[data-media]:not([data-done])").forEach(el=>{
    const id=el.dataset.media;el.dataset.done="1";
    loadMedia(id).then(url=>{
      if(!url){el.innerHTML='<span>🔒 Medya açılamadı</span>';return}
      const c=plain[id]||{};
      if(c.t==="img"){const img=new Image();img.className="media";img.alt="Fotoğraf";img.src=url;if(c.w&&c.h)img.style.aspectRatio=c.w+"/"+c.h;img.onclick=()=>openViewer(url);el.replaceWith(img)}
      else if(c.t==="voice"){const a=document.createElement("audio");a.controls=true;a.preload="metadata";a.src=url;el.replaceWith(a)}
    });
  });
}

/* ---------- helpers ---------- */
function hash(s){let h=0;for(const c of s)h=(h*31+c.codePointAt(0))|0;return Math.abs(h)}
const colorOf=id=>COLORS[hash(id||"x")%COLORS.length];
function realName(uid){if(uid===me)return"Sen";return users[uid]?.nick||(users[uid]?.code?"TR "+fmtCode(users[uid].code):"Biri")}
const isVipU=u=>(vipU[u]||0)>Date.now();
const vipMark=u=>isVipU(u)?'<span class="vipb" title="VIP">👑</span>':"";
function convTitle(c){return isGroupConv(c)?(groups[gidOf(c)]?.name||"Grup"):realName(c)}
const initials=n=>(n.replace(/[^\p{L}\s]/gu,"").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("")||"?").toLocaleUpperCase("tr");
function avHTML(c,{size}={}){
  const st=size?`width:${size}px;height:${size}px;`:"";
  if(isGroupConv(c))return`<div class="av grp" style="${st}background:${colorOf(c)}">👥</div>`;
  const n=c===me?(users[me]?.nick||"Ben"):realName(c);
  return`<div class="av" style="${st}background:${colorOf(c)}">${esc(initials(n))}</div>`;
}
const convOfMsg=m=>m.gid?"g:"+m.gid:(m.from===me?m.to:m.from);
function hm(t){return new Date(t).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}
function when(t){const d=new Date(t),n=new Date();
  if(d.toDateString()===n.toDateString())return hm(t);
  const y=new Date(n);y.setDate(n.getDate()-1);
  if(d.toDateString()===y.toDateString())return"Dün";
  return d.toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"})}
function dayLabel(t){const w=when(t);return w.includes(":")?"Bugün":w}
const fmtDur=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
function tick(m){
  if(m.pending)return'<svg class="tk" viewBox="0 0 16 11"><path d="M8 1v5l3 2"/></svg>';
  const read=!m.gid&&(reads[m.to+"_"+me]||0)>=m.at;
  return`<svg class="tk ${read?"read":""}" viewBox="0 0 16 11"><path d="M1 6l3 3 6-7"/><path d="M6 9l1 0 6-7"/></svg>`;
}
const contentOf=m=>m.pending?m.content:(plain[m.id]??null);
function previewText(c){if(!c)return"🔒 Mesaj";if(c.t==="game")return c.kind==="pool"?"🎱 Bilardo daveti":"🀄 Okey daveti";if(c.t==="img")return"📷 Fotoğraf";if(c.t==="voice")return"🎤 Sesli mesaj"+(c.dur?" ("+fmtDur(c.dur)+")":"");if(c.t==="sys")return c.text;return c.text||""}
function toast(t,ms=2200){const el=$("#toast");el.textContent=t;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),ms)}
function banner(t){const b=$("#banner");if(t){b.textContent=t;b.classList.add("show")}else b.classList.remove("show")}
function convMsgs(c){return raw.filter(m=>convOfMsg(m)===c).concat(pending.filter(m=>m.conv===c)).sort((a,b)=>a.at-b.at)}
function unreadOf(c){const last=reads[me+"_"+c]||0;return raw.filter(m=>m.from!==me&&convOfMsg(m)===c&&m.at>last).length}

/* ---------- render: list ---------- */
function chatEntries(){
  const convs=new Set(contacts.filter(u=>u&&u!==me));
  Object.keys(groups).forEach(g=>convs.add("g:"+g));
  raw.forEach(m=>{const c=convOfMsg(m);if(!isGroupConv(c)||groups[gidOf(c)])convs.add(c)});
  pending.forEach(m=>convs.add(m.conv));
  if(cur)convs.add(cur);
  return[...convs].map(c=>{const ms=convMsgs(c);return{c,title:convTitle(c),last:ms[ms.length-1],unread:unreadOf(c),at:ms.length?ms[ms.length-1].at:(isGroupConv(c)?groups[gidOf(c)]?.at||0:0)}})
    .sort((a,b)=>b.at-a.at);
}
function renderChats(){
  if(!ready)return;
  let list=chatEntries();
  const q=query_;
  if(q)list=list.filter(e=>e.title.toLocaleLowerCase("tr").includes(q)||(!isGroupConv(e.c)&&(users[e.c]?.code||"").includes(q.replace(/\s/g,"")))||convMsgs(e.c).some(m=>(contentOf(m)?.text||"").toLocaleLowerCase("tr").includes(q)));
  const reqs=Object.keys(friends).filter(u=>incomingReq(u)&&!isBlocked(u));
  const reqSet=new Set(reqs);
  list=list.filter(e=>!reqSet.has(e.c));
  const reqHtml=reqs.length&&!q?`<div class="section">Arkadaşlık istekleri (${reqs.length})</div>`+reqs.map(u=>`<div class="row" data-open="${esc(u)}">${avHTML(u)}<div class="meta"><div class="l1"><span class="name">${esc(realName(u))}</span></div><div class="l2"><span class="prev">${users[u]?.code?"TR ID "+esc(fmtCode(users[u].code)):"İstek gönderdi"}</span></div></div><div class="frbtns"><button class="ok" data-frok="${esc(u)}">Kabul</button><button class="no" data-frno="${esc(u)}">Reddet</button></div></div>`).join("")+(list.length?`<div class="section">Sohbetler</div>`:""):"";
  const html=reqHtml+list.map(e=>{
    const l=e.last,g=isGroupConv(e.c);let prev;
    if(l){const who=l.from===me?tick(l)+" ":(g?esc(realName(l.from).split(" ")[0])+": ":"");prev=`<span class="prev">${who}${esc(previewText(contentOf(l)))}</span>`}
    else prev=`<span class="prev">${g?"Grup oluşturuldu":(isBlocked(e.c)?"Engellendi":isFriend(e.c)?"Mesaj göndermek için dokun":esc(friendNote(e.c)))}</span>`;
    return`<div class="row" data-open="${esc(e.c)}"${e.c===cur?' style="background:var(--bg)"':''}>${avHTML(e.c)}
      <div class="meta"><div class="l1"><span class="name">${esc(e.title)}${g?"":vipMark(e.c)}</span><span class="time ${e.unread?"unread":""}">${e.at?when(e.at):""}</span></div>
      <div class="l2">${prev}${e.unread?`<span class="badge">${e.unread>99?"99+":e.unread}</span>`:""}</div></div></div>`}).join("");
  $("#pane-chats").innerHTML=html||(q?`<div class="empty">Sonuç bulunamadı</div>`:
    `<div class="empty">Henüz sohbetin yok.<br><br>Senin TR ID'n:<div class="idbox" style="margin:12px auto;max-width:220px">${esc(fmtCode(users[me]?.code)||"…")}</div>Arkadaşının ID'sini eklemek için <b>+</b> düğmesine dokun.</div>`);
}

/* ---------- render: status ---------- */
function renderStatus(){
  if(!ready)return;
  const DAY=24*3600e3,now=Date.now();
  const mine=statuses[me]&&now-statuses[me].at<DAY?statuses[me]:null;
  let seen={};try{seen=JSON.parse(localStorage.getItem("tr-seen")||"{}")}catch(e){}
  const known=new Set(chatEntries().map(e=>e.c));
  const items=Object.entries(statuses).filter(([u,s])=>u!==me&&known.has(u)&&s&&now-s.at<DAY).map(([u,s])=>({u,s,seen:seen[u]===s.at})).sort((a,b)=>b.s.at-a.s.at);
  const row=i=>`<div class="row" data-story="${esc(i.u)}"><div class="ring ${i.seen?"seen":""}">${avHTML(i.u)}</div><div class="meta"><div class="name">${esc(realName(i.u))}</div><div class="prev">${when(i.s.at)}</div></div></div>`;
  const nw=items.filter(i=>!i.seen),sn=items.filter(i=>i.seen);
  $("#pane-status").innerHTML=`<div class="row" data-act="${mine?"viewmine":"mystatus"}"><div style="position:relative">${mine?`<div class="ring">${avHTML(me)}</div>`:avHTML(me)}${mine?"":`<span class="plus">+</span>`}</div><div class="meta"><div class="name">Durumum</div><div class="prev">${mine?esc(mine.text)+" · "+when(mine.at):"Durum eklemek için dokun"}</div></div></div>`+
    (mine?`<div class="row" data-act="mystatus"><div class="av" style="background:var(--bg);color:var(--brand)">✎</div><div class="meta"><div class="name">Yeni durum paylaş</div></div></div>`:"")+
    (nw.length?`<div class="section">Son güncellemeler</div>`+nw.map(row).join(""):"")+
    (sn.length?`<div class="section">Görüntülenenler</div>`+sn.map(row).join(""):"")+
    (!items.length?`<div class="empty">Kişilerinden son 24 saatte paylaşılan durum yok</div>`:"");
}

/* ---------- render: chat ---------- */
let lastRenderedCount=0;
function renderChatHeader(){
  if(!cur)return;
  $("#cAvWrap").innerHTML=avHTML(cur);
  $("#cName").innerHTML=esc(convTitle(cur))+(isGroupConv(cur)?"":vipMark(cur));
  $("#acallBtn").style.display=$("#vcallBtn").style.display=isGroupConv(cur)||!isFriend(cur)?"none":"";
  $("#gameBtn").style.display=isGroupConv(cur)||isFriend(cur)?"":"none";
  if(isGroupConv(cur)){const g=groups[gidOf(cur)];$("#cSub").textContent=g?g.members.map(realName).join(", "):"Bu gruptan çıkarıldın"}
  else{const code=users[cur]?.code;$("#cSub").textContent=code?"TR ID: "+fmtCode(code):""}
}
function bubbleBody(m,c){
  if(!c)return(m.id in plain)?'<i style="opacity:.7">🔒 Bu mesaj çözülemedi</i>':'<i style="opacity:.6">🔒 …</i>';
  if(c.t==="img"){
    if(c._local)return`<img class="media" src="${esc(c._local)}" alt="Fotoğraf">`;
    const ar=c.w&&c.h?` style="aspect-ratio:${+c.w}/${+c.h};height:auto"`:"";
    return`<div class="mload" data-media="${esc(m.id)}"${ar}>📷 Yükleniyor…</div>`;
  }
  if(c.t==="game")return`<div class="gamecard" data-game="${esc(c.gid)}"><span class="gi">${c.kind==="pool"?"🎱":"🀄"}</span><div><b>${c.kind==="pool"?"Bilardo masası":"Okey masası"}</b><span>${c.stake?"Masa ücreti "+(+c.stake).toLocaleString("tr-TR")+" jeton":"Ücretsiz masa"}</span></div><span class="go">Masaya git</span></div>`;
  if(c.t==="voice"){
    if(c._local)return`<audio controls src="${esc(c._local)}"></audio>`;
    return`<div class="mload" style="height:44px" data-media="${esc(m.id)}">🎤 Yükleniyor… ${c.dur?fmtDur(c.dur):""}</div>`;
  }
  return esc(c.text);
}
function renderMsgs(){
  if(!cur)return;
  const box=$("#msgs"),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;
  const list=convMsgs(cur),g=isGroupConv(cur);
  const grp=g?groups[gidOf(cur)]:null;
  let html=`<div class="lock">🔒 Mesajlar uçtan uca şifreli. ${g?"Bu sohbeti sadece grup üyeleri okuyabilir.":"Bu sohbeti sadece sen ve "+esc(realName(cur))+" okuyabilir."}</div>`,lastDay="",prevFrom=null;
  if(!g&&!validPub(users[cur]?.pub))html+=`<div class="day"><span>Bu kişinin şifreleme anahtarı henüz hazır değil.</span></div>`;
  if(g&&!grp)html+=`<div class="day"><span>Artık bu grubun üyesi değilsin.</span></div>`;
  list.forEach(m=>{const d=dayLabel(m.at);if(d!==lastDay){html+=`<div class="day"><span>${d}</span></div>`;lastDay=d;prevFrom=null}
    const mine=m.from===me,c=contentOf(m);
    const who=g&&!mine&&prevFrom!==m.from?`<span class="who" style="color:${colorOf(m.from)}">${esc(realName(m.from))}</span>`:"";
    html+=`<div class="b ${mine?"out":"in"} ${m.pending?"pending":""}">${who}${bubbleBody(m,c)}<span class="s">${hm(m.at)}${mine?tick(m):""}</span></div><div class="clear"></div>`;
    prevFrom=m.from});
  box.innerHTML=html;
  hydrateMedia();
  if(atBottom||list.length!==lastRenderedCount)box.scrollTop=box.scrollHeight;
  lastRenderedCount=list.length;
  const okFriend=renderFriendBar();
  const canSend=g?!!grp:okFriend;
  $("#composer").style.display=canSend?"":"none";
}
function renderAll(){renderChats();renderStatus();if(tabNow==="calls")renderCalls();if(cur){renderChatHeader();renderMsgs()}}

/* ---------- okundu ---------- */
const readBusy={};
async function markRead(c){
  if(!me)return;
  const ms=raw.filter(m=>m.from!==me&&convOfMsg(m)===c);if(!ms.length)return;
  const latest=Math.max(...ms.map(m=>m.at));
  const id=me+"_"+c;
  if((reads[id]||0)>=latest)return;
  reads[id]=latest;
  if(readBusy[id])return;readBusy[id]=true;
  try{await setDoc(doc(fs,"reads",id),{members:[me,c],at:latest})}catch(e){}
  readBusy[id]=false;
}

/* ---------- kişiler ---------- */
const contactsRef=()=>doc(fs,"private",me,"data","contacts");
async function saveContact(uid){
  if(contacts.includes(uid))return;
  const prev=contacts;contacts=[...contacts,uid].slice(-500);renderChats();
  try{await setDoc(contactsRef(),{list:contacts})}catch(e){contacts=prev;renderChats()}
}
async function addById(input){
  const code=String(input).replace(/\D/g,"");
  if(code.length!==6){toast("ID 6 haneli olmalı");return}
  if(code===users[me]?.code){toast("Bu senin kendi ID'n 🙂");return}
  let uid=null;
  try{const s=await getDoc(doc(fs,"codes",code));if(s.exists())uid=s.data().uid}catch(e){}
  if(!uid){toast("Bu ID ile kimse bulunamadı");return}
  watchUser(uid);
  if(!users[uid]){try{const u=await getDoc(doc(fs,"users",uid));if(u.exists())users[uid]=cleanUser(u.data())}catch(e){}}
  await saveContact(uid);openChat(uid);
  if(!isFriend(uid))await sendRequest(uid);
}

/* ---------- engelleme, şikâyet, askı ---------- */
const isBlocked=u=>!!blocked[u];
function confirmBlock(u){
  openModal({title:"Engelle",text:`${esc(realName(u))} engellensin mi? Arkadaşlığınız biter, sana istek gönderemez ve mesaj atamaz. İstediğin zaman engeli kaldırabilirsin.`,input:false,ok:"Engelle"},()=>blockUser(u));
}
async function blockUser(u){
  blocked[u]=true;renderAll();
  try{
    await setDoc(doc(fs,"blocks",me+"_"+u),{by:me,target:u,at:Date.now()});
    if(friends[u]){const f=friends[u];delete friends[u];await deleteDoc(doc(fs,"friends",f.id)).catch(()=>{})}
    toast("Engellendi");
  }catch(e){delete blocked[u];renderAll();toast("Engellenemedi")}
}
async function unblockUser(u){
  delete blocked[u];renderAll();
  try{await deleteDoc(doc(fs,"blocks",me+"_"+u));toast("Engel kaldırıldı")}catch(e){blocked[u]=true;renderAll();toast("İşlem yapılamadı")}
}
const REP_REASONS=[["taciz","Taciz veya hakaret"],["spam","Spam veya dolandırıcılık"],["uygunsuz","Uygunsuz içerik"],["hile","Oyunda hile"],["diger","Diğer"]];
// target: şikâyet edilen kişi (grup için kuran kişi). conv: son mesajların alınacağı sohbet
function openReport(target,conv){
  if(!target){toast("Kendi kurduğun grubu şikâyet edemezsin");return}
  const g=isGroupConv(conv);
  openInfoModal("Şikâyet et",`<p class="isub">${g?"Grup":esc(realName(target))} hakkındaki şikâyetin yöneticilere gider. Kim olduğun şikâyet edilen kişiye söylenmez.</p>
    <div class="replist">${REP_REASONS.map(([k,t],i)=>`<label class="repr"><input type="radio" name="rr" value="${k}" ${i?"":"checked"}> ${t}</label>`).join("")}</div>
    <textarea id="repNote" maxlength="500" rows="3" placeholder="Ne oldu? (isteğe bağlı)"></textarea>
    <label class="repr"><input type="checkbox" id="repMsgs" checked> <span>Son 10 mesajı şikâyete ekle<br><span class="isub">Mesajlar şifreli olduğu için yöneticiler ancak sen eklersen görebilir.</span></span></label>
    ${g?"":`<label class="repr"><input type="checkbox" id="repBlock" ${isBlocked(target)?"disabled":"checked"}> Bu kişiyi engelle</label>`}
    <div class="row2" style="margin-top:8px"><button id="repSend" style="background:#E53935">Şikâyet et</button></div>`);
  $("#repSend").onclick=async()=>{
    const reason=document.querySelector('input[name="rr"]:checked')?.value||"diger";
    let msgs=[];
    if($("#repMsgs").checked){
      msgs=raw.filter(m=>convOfMsg(m)===conv).sort((a,b)=>a.at-b.at).slice(-10).map(m=>{
        const c=contentOf(m);return(m.from===me?"Ben":realName(m.from))+" · "+new Date(m.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+": "+previewText(c).slice(0,300)});
    }
    const ctx=g?"grup: "+(groups[gidOf(conv)]?.name||"").slice(0,60):"birebir sohbet";
    $("#repSend").disabled=true;
    try{
      await addDoc(collection(fs,"reports"),{by:me,target,reason,note:$("#repNote").value.trim().slice(0,500),msgs,ctx,at:Date.now(),status:"open"});
      if(!g&&$("#repBlock")?.checked&&!isBlocked(target))await blockUser(target);
      closeE();toast("Şikâyetin alındı. Teşekkürler.",3000);
    }catch(e){$("#repSend").disabled=false;toast("Gönderilemedi")}
  };
}
function renderBan(){
  const el=$("#banscr");if(!el)return;
  if(!myBan){el.classList.remove("show");return}
  const forever=myBan.until>Date.now()+3650*86400e3;
  el.innerHTML=`<div class="banbox"><div style="font-size:46px">⛔</div><h2>Hesabın ${forever?"kalıcı olarak kapatıldı":"askıya alındı"}</h2>
    ${forever?"":`<p><b>${new Date(myBan.until).toLocaleString("tr-TR",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}</b> tarihine kadar mesaj gönderemez, arama yapamaz ve oyun oynayamazsın.</p>`}
    ${myBan.reason?`<p>Sebep: ${esc(myBan.reason)}</p>`:""}
    <p class="isub">Bir hata olduğunu düşünüyorsan <a href="mailto:${SUPPORT_MAIL}?subject=TR%20hesap%20itiraz">${SUPPORT_MAIL}</a> adresine yaz.</p>
    <button id="banOut">Çıkış yap</button></div>`;
  el.classList.add("show");
  $("#banOut").onclick=()=>signOut(auth);
}
const SUPPORT_MAIL="telekomnetharun@gmail.com";

/* ---------- hesap silme ---------- */
function askDeleteAccount(){
  openInfoModal("Hesabımı sil",`<p>Hesabını silersen <b>geri alınamaz</b>:</p>
    <ul class="dl"><li>Profilin, TR ID'n ve şifreleme anahtarların silinir</li><li>Bütün mesajların, fotoğrafların ve sesli mesajların silinir</li><li>Arkadaşlıkların biter, gruplardan çıkarılırsın</li><li>Jetonların, VIP üyeliğin ve desenlerin silinir</li></ul>
    <p class="isub">Jeton hareket kayıtları yasal saklama süresi boyunca isimsiz olarak tutulur.</p>
    <p>Onaylamak için aşağıya büyük harflerle <b>SİL</b> yaz:</p><input id="delConfirm" autocomplete="off" placeholder="SİL">
    <div class="row2" style="margin-top:8px"><button id="delGo" style="background:#E53935">Hesabımı kalıcı olarak sil</button></div>`);
  $("#delGo").onclick=async()=>{
    if($("#delConfirm").value.trim().toLocaleUpperCase("tr-TR")!=="SİL"){toast("Onay için SİL yaz");return}
    $("#delGo").disabled=true;$("#delGo").textContent="Siliniyor…";
    try{await callApi("/api/account",{action:"delete",confirm:"SİL"});closeE();toast("Hesabın silindi",4000);
      try{localStorage.clear()}catch(e){}
      setTimeout(()=>signOut(auth),800)}
    catch(e){$("#delGo").disabled=false;$("#delGo").textContent="Hesabımı kalıcı olarak sil";toast("Silinemedi, tekrar dene")}
  };
}

/* ---------- 18 yaş ---------- */
// Jetonlu masalar ve VIP 18 yaş üstüne açık. Doğum yılı bir kez sorulur, sonra değiştirilemez.
function askAge(then){
  const now=new Date().getFullYear();
  openInfoModal("Yaş doğrulama",`<p>Jetonlu masalar ve VIP üyelik sadece <b>18 yaşından büyükler</b> içindir. Doğum yılını bir kez soruyoruz, sonra değiştirilemez.</p>
    <select id="ageY">${Array.from({length:100},(_,i)=>now-i).map(y=>`<option value="${y}" ${y===now-25?"selected":""}>${y}</option>`).join("")}</select>
    <label class="repr" id="ageBdRow"><input type="checkbox" id="ageBd"> Bu yılki doğum günüm geçti</label>
    <div class="row2" style="margin-top:8px"><button id="ageOk" style="background:var(--brand)">Onayla</button></div>`);
  const upd=()=>{$("#ageBdRow").style.display=now-+$("#ageY").value===18?"":"none"};upd();$("#ageY").onchange=upd;
  $("#ageOk").onclick=async()=>{
    $("#ageOk").disabled=true;
    try{const r=await callApi("/api/wallet",{action:"age",birthYear:+$("#ageY").value,hadBirthday:$("#ageBd").checked});applyWallet({...r.wallet});closeE();
      if(r.wallet.adult){toast("Teşekkürler");then&&then()}else toast("18 yaşından küçükler sadece ücretsiz masalarda oynayabilir",4000)}
    catch(e){$("#ageOk").disabled=false;toast("Kaydedilemedi")}
  };
}

/* ---------- arkadaşlık ---------- */
// friends/{küçükUid_büyükUid}. İstek kabul edilmeden mesaj, arama ve oyun yok (kurallar da zorunlu kılar).
const pairId=(a,b)=>a<b?a+"_"+b:b+"_"+a;
const isFriend=u=>friends[u]?.status==="accepted";
const incomingReq=u=>friends[u]?.status==="pending"&&friends[u].to===me;
async function sendRequest(uid){
  if(isBlocked(uid)){toast("Önce engeli kaldır");return}
  const f=friends[uid];
  if(f?.status==="accepted")return;
  if(incomingReq(uid)){await answerRequest(uid,true);return}
  if(f?.status==="pending"){toast("İstek zaten gönderildi, kabul etmesini bekle");return}
  const id=pairId(me,uid),data={members:me<uid?[me,uid]:[uid,me],from:me,to:uid,status:"pending",at:Date.now()};
  friends[uid]={id,...data};renderAll();
  try{await setDoc(doc(fs,"friends",id),data);callApi("/api/notify",{friend:id}).catch(()=>{});toast("Arkadaşlık isteği gönderildi")}
  catch(e){if(f)friends[uid]=f;else delete friends[uid];renderAll();
    toast(f&&f.from===me?"Kabul edilmeyen isteği 24 saat sonra tekrar gönderebilirsin":"İstek gönderilemedi",3000)}
}
async function answerRequest(uid,ok){
  const f=friends[uid];if(!f||!incomingReq(uid))return;
  const data={members:f.members,from:f.from,to:f.to,status:ok?"accepted":"declined",at:Date.now()};
  friends[uid]={...f,...data};renderAll();
  try{await setDoc(doc(fs,"friends",f.id),data);
    if(ok){saveContact(uid);callApi("/api/notify",{friend:f.id}).catch(()=>{});toast("Artık arkadaşsınız 🎉")}else toast("İstek reddedildi")}
  catch(e){friends[uid]=f;renderAll();toast("İşlem yapılamadı")}
}
async function removeFriend(uid){
  const f=friends[uid];if(!f)return;
  delete friends[uid];renderAll();
  try{await deleteDoc(doc(fs,"friends",f.id))}catch(e){friends[uid]=f;renderAll();toast("İşlem yapılamadı")}
}
function friendNote(u){
  const f=friends[u];
  if(!f)return"Arkadaş değilsiniz";
  if(f.status==="pending")return f.from===me?"İstek gönderildi · bekleniyor":"Sana arkadaşlık isteği gönderdi";
  if(f.status==="declined")return f.from===me?"İsteğin kabul edilmedi":"İsteği reddettin";
  return"";
}
function renderFriendBar(){
  const bar=$("#frbar");
  if(!cur||isGroupConv(cur)||(isFriend(cur)&&!isBlocked(cur))){bar.classList.remove("show");bar.innerHTML="";return true}
  const f=friends[cur],n=esc(realName(cur));
  let h;
  if(isBlocked(cur))h=`<div><b>${n}</b> kişisini engelledin. Sana istek gönderemez, mesaj atamaz.</div><div class="acts"><button class="no" data-frunb="${esc(cur)}">Engeli kaldır</button></div>`;
  else if(incomingReq(cur))h=`<div><b>${n}</b> sana arkadaşlık isteği gönderdi.</div><div class="acts"><button class="ok" data-frok="${esc(cur)}">Kabul et</button><button class="no" data-frno="${esc(cur)}">Reddet</button></div>`;
  else if(f?.status==="pending")h=`<div>İstek gönderildi. <b>${n}</b> kabul edince mesajlaşabilirsiniz.</div><div class="acts"><button class="no" data-frdel="${esc(cur)}">İsteği geri al</button></div>`;
  else if(f?.status==="declined"&&f.from===me)h=`<div><b>${n}</b> isteğini kabul etmedi.</div><div class="acts"><button class="ok" data-frreq="${esc(cur)}">Tekrar istek gönder</button></div>`;
  else h=`<div>Mesajlaşmak için önce arkadaş olmalısınız.</div><div class="acts"><button class="ok" data-frreq="${esc(cur)}">Arkadaşlık isteği gönder</button></div>`;
  bar.innerHTML=h;bar.classList.add("show");
  return false;
}
function friendButtons(e){
  const b=e.target.closest("[data-frok],[data-frno],[data-frreq],[data-frdel],[data-frunb]");if(!b)return false;
  e.preventDefault();e.stopPropagation();
  if(b.dataset.frok)answerRequest(b.dataset.frok,true);
  else if(b.dataset.frno)answerRequest(b.dataset.frno,false);
  else if(b.dataset.frreq)sendRequest(b.dataset.frreq);
  else if(b.dataset.frdel)removeFriend(b.dataset.frdel);
  else if(b.dataset.frunb)unblockUser(b.dataset.frunb);
  return true;
}
$("#frbar").addEventListener("click",friendButtons);
function openFriends(){
  const list=Object.keys(friends).filter(isFriend).sort((a,b)=>realName(a).localeCompare(realName(b),"tr"));
  openModal({title:"Arkadaşlarım ("+list.length+")",input:false,ok:"Arkadaş ekle",cancelText:"Kapat",
    text:list.length?`<div class="flist">${list.map(u=>`<div class="gitem" data-fopen="${esc(u)}">${avHTML(u)}<div class="gn"><b>${esc(realName(u))}${vipMark(u)}</b><span>${users[u]?.code?"TR ID "+esc(fmtCode(users[u].code)):""}</span></div></div>`).join("")}</div>`:"Henüz arkadaşın yok. TR ID ile istek gönderebilirsin."},askAdd);
}
$("#mText").addEventListener("click",e=>{const r=e.target.closest("[data-fopen]");if(r){closeAll();openChat(r.dataset.fopen)}});

/* ---------- gruplar ---------- */
function peopleList(){return[...new Set([...contacts,...raw.filter(m=>!m.gid).map(convOfMsg),...Object.keys(friends)])].filter(u=>u&&u!==me&&isFriend(u))}
function memberRow(uid,{check,checked,tag,remove}={}){
  return`<label class="gitem" data-uid="${esc(uid)}">${avHTML(uid)}<div class="gn"><b>${esc(uid===me?(users[me]?.nick||"Sen")+" (sen)":realName(uid))}</b><span>${users[uid]?.code?"TR ID "+esc(fmtCode(users[uid].code)):""}</span></div>${tag?`<span class="tag">${esc(tag)}</span>`:""}${check?`<input type="checkbox" value="${esc(uid)}"${checked?" checked":""}>`:""}${remove?`<button type="button" class="ibtn" data-remove="${esc(uid)}" aria-label="Çıkar" style="color:#E53935;width:34px;height:34px">✕</button>`:""}</label>`;
}
let gMode=null;
function openGroupModal(mode,gid){
  gMode={mode,gid};closeAll();
  const people=peopleList();
  const g=gid?groups[gid]:null;
  const candidates=mode==="create"?people:people.filter(u=>!g.members.includes(u));
  $("#gTitle").textContent=mode==="create"?"Yeni grup":"Üye ekle";
  $("#gName").style.display=mode==="create"?"":"none";$("#gName").value="";
  $("#gListLabel").textContent=candidates.length?"Üyeleri seç":"";
  $("#gList").innerHTML=candidates.length?candidates.map(u=>memberRow(u,{check:true})).join(""):`<div class="empty" style="padding:20px">${mode==="create"?"Grup kurmak için önce arkadaş eklemelisin.":"Eklenecek başka kişin yok."}</div>`;
  $("#gErr").textContent="";$("#gOk").textContent=mode==="create"?"Oluştur":"Ekle";$("#gOk").disabled=false;
  overlay.classList.add("show");$("#gmodal").classList.add("show");
  if(mode==="create")setTimeout(()=>$("#gName").focus(),60);
}
function closeGroupModal(){$("#gmodal").classList.remove("show");overlay.classList.remove("show")}
$("#gCancel").onclick=closeGroupModal;
$("#gOk").onclick=async()=>{
  const sel=[...document.querySelectorAll("#gList input:checked")].map(i=>i.value).filter(u=>validPub(users[u]?.pub));
  if(gMode.mode==="create"){
    const name=$("#gName").value.trim().slice(0,50);
    if(hasBad(name)){toast("Grup adında uygunsuz kelime var",3000);return}
    if(!name){$("#gErr").textContent="Grup adını yaz";return}
    if(!sel.length){$("#gErr").textContent="En az bir kişi seç";return}
    if(sel.length+1>MAX_GROUP){$("#gErr").textContent=`En fazla ${MAX_GROUP} kişi olabilir`;return}
    $("#gOk").disabled=true;
    const ref=doc(collection(fs,"groups"));
    const g={name,members:[me,...sel],admins:[me],createdBy:me,at:Date.now()};
    try{await setDoc(ref,g);groups[ref.id]=g;closeGroupModal();openChat("g:"+ref.id);toast("Grup oluşturuldu")}
    catch(e){$("#gErr").textContent="Grup oluşturulamadı";$("#gOk").disabled=false}
  }else{
    const g=groups[gMode.gid];if(!g)return;
    if(!sel.length){$("#gErr").textContent="Kimseyi seçmedin";return}
    if(g.members.length+sel.length>MAX_GROUP){$("#gErr").textContent=`En fazla ${MAX_GROUP} kişi olabilir`;return}
    $("#gOk").disabled=true;
    try{await setDoc(doc(fs,"groups",gMode.gid),{...g,members:[...g.members,...sel]});closeGroupModal();toast("Eklendi. Yeni üyeler bundan sonraki mesajları görecek.")}
    catch(e){$("#gErr").textContent="Eklenemedi";$("#gOk").disabled=false}
  }
};
function openInfo(){
  if(!cur)return;closeAll();
  if(isGroupConv(cur)){
    const gid=gidOf(cur),g=groups[gid];if(!g)return;
    const admin=g.admins.includes(me);
    $("#iAv").innerHTML=avHTML(cur);$("#iName").textContent=g.name;$("#iSub").textContent=g.members.length+" üye";
    $("#iLabel").textContent="Üyeler";
    $("#iList").innerHTML=g.members.map(u=>memberRow(u,{tag:g.admins.includes(u)?"yönetici":"",remove:admin&&u!==me})).join("");
    $("#iActs").innerHTML=(admin?`<button id="iAdd">Üye ekle</button><button id="iRename">Adını değiştir</button>`:"")+`<button class="danger" id="iRep">Şikâyet et</button><button class="danger" id="iLeave">Gruptan çık</button><button class="pri" id="iClose">Kapat</button>`;
    $("#iRep").onclick=()=>{closeInfo();openReport(g.createdBy===me?null:g.createdBy,"g:"+gid)};
    if(admin){$("#iAdd").onclick=()=>{closeInfo();openGroupModal("add",gid)};
      $("#iRename").onclick=()=>{closeInfo();openModal({title:"Grup adı",value:g.name,ok:"Kaydet"},async v=>{if(hasBad(v)){toast("Grup adında uygunsuz kelime var",3000);return}try{await setDoc(doc(fs,"groups",gid),{...g,name:v.slice(0,50)})}catch(e){toast("Değiştirilemedi")}})};}
    $("#iLeave").onclick=()=>{closeInfo();openModal({title:"Gruptan çık",text:`“${esc(g.name)}” grubundan çıkmak istiyor musun?`,input:false,ok:"Çık"},async()=>{
      const members=g.members.filter(u=>u!==me),admins=g.admins.filter(u=>u!==me);
      try{await setDoc(doc(fs,"groups",gid),{...g,members,admins:admins.length||!members.length?admins:[members[0]]});
        delete groups[gid];closeChat();toast("Gruptan çıktın")}catch(e){toast("Çıkılamadı")}})};
    $("#iList").onclick=e=>{const b=e.target.closest("[data-remove]");if(!b)return;e.preventDefault();const u=b.dataset.remove;
      openModal({title:"Üyeyi çıkar",text:`${esc(realName(u))} gruptan çıkarılsın mı?`,input:false,ok:"Çıkar"},async()=>{
        try{await setDoc(doc(fs,"groups",gid),{...g,members:g.members.filter(x=>x!==u),admins:g.admins.filter(x=>x!==u)});toast("Çıkarıldı")}catch(e){toast("Çıkarılamadı")}})};
  }else{
    const u=users[cur]||{};
    $("#iAv").innerHTML=avHTML(cur);$("#iName").innerHTML=esc(realName(cur))+vipMark(cur);recordView(cur);$("#iSub").textContent=u.code?"TR ID "+fmtCode(u.code):"";
    $("#iLabel").textContent="";
    const common=Object.entries(groups).filter(([,g])=>g.members.includes(cur));
    $("#iList").innerHTML=common.length?`<div class="fl" style="padding:0 8px">Ortak gruplar</div>`+common.map(([id,g])=>`<div class="gitem" data-g="${esc(id)}">${avHTML("g:"+id)}<div class="gn"><b>${esc(g.name)}</b><span>${g.members.length} üye</span></div></div>`).join(""):"";
    const f=friends[cur];
    const bl=isBlocked(cur);
    $("#iActs").innerHTML=(isFriend(cur)?`<button class="danger" id="iUnf">Arkadaşlıktan çıkar</button>`:"")+`<button class="danger" id="iBlock">${bl?"Engeli kaldır":"Engelle"}</button><button class="danger" id="iRep">Şikâyet et</button><button class="pri" id="iClose">Kapat</button>`;
    {const peer=cur;$("#iBlock").onclick=()=>{closeInfo();bl?unblockUser(peer):confirmBlock(peer)};$("#iRep").onclick=()=>{closeInfo();openReport(peer,peer)}}
    if(isFriend(cur)){const peer=cur;$("#iUnf").onclick=()=>{closeInfo();openModal({title:"Arkadaşlıktan çıkar",text:`${esc(realName(peer))} arkadaşlıktan çıkarılsın mı? Tekrar yazışmak için yeni istek gerekir.`,input:false,ok:"Çıkar"},()=>removeFriend(peer))}}
    $("#iList").onclick=e=>{const r=e.target.closest("[data-g]");if(r){closeInfo();openChat("g:"+r.dataset.g)}};
  }
  $("#iClose").onclick=closeInfo;
  overlay.classList.add("show");$("#imodal").classList.add("show");
}
function closeInfo(){$("#imodal").classList.remove("show");overlay.classList.remove("show")}
$("#chatTitle").onclick=openInfo;$("#cAvWrap").onclick=openInfo;

/* ---------- navigation ---------- */
function openChat(c){
  cur=c;lastRenderedCount=-1;
  $("#emojis").classList.remove("show");
  renderChatHeader();renderMsgs();
  $("#chat").classList.remove("hidden");$("#placeholder").classList.add("off");
  markRead(c);renderChats();updateSendIcon();
  try{if(!history.state||!history.state.chat)history.pushState({chat:c},"");else history.replaceState({chat:c},"")}catch(e){}
}
function closeChat(){if(rec)stopRec(false);$("#chat").classList.add("hidden");$("#placeholder").classList.remove("off");cur=null;renderChats()}
$("#back").onclick=()=>{try{if(history.state&&history.state.chat){history.back();return}}catch(e){}closeChat()};
window.addEventListener("popstate",()=>{if($("#viewer").classList.contains("show")){closeViewer();return}if(game)return;if(cur)closeChat()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#viewer").classList.contains("show")){closeViewer();return}if(cur&&!document.querySelector(".modal.show")&&!$("#story.show"))$("#back").click()});
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  tabNow=t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="pane-"+tabNow));
  if(tabNow==="calls")renderCalls();
  if(tabNow==="games")renderGamesTab();
  $("#fab").innerHTML=tabNow==="chats"||tabNow==="calls"?'<svg viewBox="0 0 24 24"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';
});
$("#btnSearch").onclick=()=>{const sb=$("#searchbar");sb.classList.toggle("show");if(sb.classList.contains("show"))$("#searchInput").focus();else{query_="";$("#searchInput").value="";renderChats()}};
$("#searchInput").oninput=e=>{query_=e.target.value.toLocaleLowerCase("tr").trim();if(tabNow!=="chats")document.querySelector('[data-tab="chats"]').click();renderChats()};
document.querySelector(".content").onclick=e=>{if(friendButtons(e))return;const r=e.target.closest(".row");if(!r)return;
  if(r.dataset.open)openChat(r.dataset.open);
  else if(r.dataset.story)openStory(r.dataset.story);
  else if(r.dataset.act==="mystatus")askStatus();
  else if(r.dataset.act==="viewmine")openStory(me)};

/* ---------- görüntüleyici ---------- */
function openViewer(url){$("#viewerImg").src=url;$("#viewer").classList.add("show");try{history.pushState({viewer:1,chat:cur},"")}catch(e){}}
function closeViewer(){$("#viewer").classList.remove("show");$("#viewerImg").src=""}
$("#viewerClose").onclick=()=>{try{if(history.state&&history.state.viewer){history.back();return}}catch(e){}closeViewer()};
$("#viewer").onclick=e=>{if(e.target.id==="viewer")$("#viewerClose").click()};
$("#msgs").addEventListener("click",e=>{const img=e.target.closest("img.media");if(img&&!img.onclick)openViewer(img.src)});

/* ---------- modal ---------- */
const overlay=$("#overlay"),menu=$("#menu"),modal=$("#modal");
let modalCb=null,profileLocked=false;
function closeAll(){overlay.classList.remove("show");menu.classList.remove("show");modal.classList.remove("show");overlay.style.background=""}
overlay.onclick=()=>{if(modal.dataset.locked==="1"||profileLocked)return;closeAll();closeProfile();closeGroupModal();closeInfo();closeContacts();closeE();$("#gpick").classList.remove("show")};
function openModal({title,text="",placeholder="",value="",ok="Tamam",cancel=true,cancelText="İptal",input=true,locked=false,numeric=false},cb){
  closeAll();overlay.classList.add("show");modal.classList.add("show");modal.dataset.locked=locked?"1":"";
  $("#mTitle").textContent=title;$("#mText").innerHTML=text;$("#mText").style.display=text?"":"none";
  const mi=$("#mInput");mi.style.display=input?"":"none";mi.placeholder=placeholder;mi.value=value;
  mi.inputMode=numeric?"numeric":"text";
  $("#mOk").textContent=ok;$("#mCancel").textContent=cancelText;$("#mCancel").style.display=cancel?"":"none";modalCb=cb;
  if(input)setTimeout(()=>mi.focus(),60)}
$("#mCancel").onclick=closeAll;
$("#mInput").onkeydown=e=>{if(e.key==="Enter")$("#mOk").click()};
$("#mOk").onclick=async()=>{const v=$("#mInput").value.trim();const cb=modalCb;
  if($("#mInput").style.display!=="none"&&!v)return;
  modal.dataset.locked="";closeAll();if(cb)await cb(v)};
$("#btnMenu").onclick=()=>{menu.classList.add("show");overlay.classList.add("show");overlay.style.background="transparent"};
function showMyId(prefix=""){
  const c=users[me]?.code;
  openModal({title:"Benim TR ID'm",input:false,ok:"Kopyala",cancelText:"Kapat",
    text:`${prefix}<div class="idbox">${esc(fmtCode(c)||"…")}</div>Bu numarayı arkadaşına ver. O “ID ile arkadaş ekle”den sana istek gönderir, sen kabul edince yazışabilirsiniz.`},
    async()=>{try{await navigator.clipboard.writeText(c);toast("ID kopyalandı")}catch(e){toast("Kopyalanamadı — numarayı elle yaz")}});
}
function askAdd(){openModal({title:"ID ile arkadaş ekle",text:"Arkadaşının 6 haneli TR ID'sini yaz. Ona arkadaşlık isteği gidecek; kabul edince yazışabilirsiniz.",placeholder:"örn. 482 913",ok:"İstek gönder",numeric:true},addById)}
menu.onclick=e=>{const a=e.target.dataset.act;if(!a)return;closeAll();
  if(a==="myid")showMyId();
  if(a==="add")askAdd();
  if(a==="friends")openFriends();
  if(a==="views")openViews();
  if(a==="delacct")askDeleteAccount();
  if(a==="terms")window.open("/kosullar.html","_blank");
  if(a==="privacy")window.open("/gizlilik.html","_blank");
  if(a==="support")location.href="mailto:"+SUPPORT_MAIL+"?subject=TR%20destek";
  if(a==="newgroup")openGroupModal("create");
  if(a==="findcontacts")findContacts();
  if(a==="notif")notifMenu();
  if(a==="profile")askProfile(false);
  if(a==="readall"){chatEntries().forEach(x=>markRead(x.c));toast("Tümü okundu")}
  if(a==="dark"){dark=!dark;document.body.classList.toggle("dark",dark);try{localStorage.setItem("tr-dark",dark?"1":"0")}catch(e){}}
  if(a==="logout")openModal({title:"Çıkış yap",text:"Hesabından çıkmak istiyor musun?",input:false,ok:"Çıkış yap"},logout);
};
$("#fab").onclick=()=>{if(tabNow==="status")askStatus();else if(tabNow==="games")openStore();else askAdd()};
document.querySelector(".content").addEventListener("click",e=>{const r=e.target.closest("[data-callback]");if(r)startCall(r.dataset.callback,r.dataset.video==="1")});

/* ---------- profil / ID ---------- */
function cleanUser(x){return{nick:typeof x.nick==="string"?cleanText(x.nick.slice(0,62)):"",first:typeof x.first==="string"?cleanText(x.first.slice(0,30)):"",last:typeof x.last==="string"?cleanText(x.last.slice(0,30)):"",code:/^\d{6}$/.test(x.code)?x.code:"",pub:validPub(x.pub)?{x:x.pub.x,y:x.pub.y}:null,joined:+x.joined||0}}
function cleanGroup(x){if(!x||!Array.isArray(x.members))return null;return{name:typeof x.name==="string"?cleanText(x.name.slice(0,50)):"Grup",members:x.members.filter(u=>typeof u==="string").slice(0,MAX_GROUP),admins:Array.isArray(x.admins)?x.admins.filter(u=>typeof u==="string"):[],createdBy:String(x.createdBy||""),at:+x.at||0}}
async function claimCode(){
  for(let i=0;i<10;i++){
    const c=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
    try{await setDoc(doc(fs,"codes",c),{uid:me});return c}catch(e){}
  }
  throw new Error("code");
}
async function saveMe(patch){
  const prev=users[me];
  const next={nick:prev?.nick||"",first:prev?.first||"",last:prev?.last||"",code:prev?.code||"",pub:prev?.pub||myPub,joined:prev?.joined||Date.now(),...patch};
  users[me]=next;renderAll();
  try{await setDoc(doc(fs,"users",me),next);return true}catch(e){users[me]=prev;renderAll();return false}
}
function updateIdLabel(){const c=users[me]?.code;$("#conn").textContent=c?"ID "+fmtCode(c):""}
function normPhone(v){let d=String(v).replace(/[^\d+]/g,"");
  if(d.startsWith("+90"))d="0"+d.slice(3);else if(d.startsWith("90")&&d.length===12)d="0"+d.slice(2);else if(d.startsWith("5")&&d.length===10)d="0"+d;
  if(/^05\d{9}$/.test(d))return d;
  if(/^\+\d{8,15}$/.test(d))return d;
  return null}
const fmtPhone=p=>/^05\d{9}$/.test(p)?p.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/,"$1 $2 $3 $4"):p;
const cap=w=>w.trim().replace(/\s+/g," ").split(" ").map(x=>x?x[0].toLocaleUpperCase("tr")+x.slice(1):"").join(" ");
let pFirstTime=false;
function askProfile(first){
  pFirstTime=first;profileLocked=first;closeAll();
  overlay.classList.add("show");$("#pmodal").classList.add("show");
  $("#pTitle").textContent=first?"TR'ye hoş geldin 👋":"Profilim";
  $("#pAcct").innerHTML=(meUser?.photoURL?`<img src="${esc(meUser.photoURL)}" alt="" referrerpolicy="no-referrer">`:"")+`<div><b>${esc(meUser?.email||"Google hesabın")}</b>${first?"Google ile giriş yaptın. Profilini tamamla.":"Giriş yapılan Google hesabı"}${users[me]?.code?" · TR ID "+esc(fmtCode(users[me].code)):""}</div>`;
  const u=users[me]||{};
  let f=u.first,l=u.last;
  if(!f&&!l){const n=(meUser?.displayName||"").trim().split(/\s+/);if(n[0]){l=n.length>1?n.pop():"";f=n.join(" ")}}
  $("#pFirst").value=f||"";$("#pLast").value=l||"";$("#pPhone").value=myPhone?fmtPhone(myPhone):"";
  $("#pErr").textContent="";$("#pCancel").style.display=first?"none":"";
  $("#pOk").textContent=first?"Başla":"Kaydet";
  $("#pTermsRow").style.display=first?"":"none";$("#pTerms").checked=false;
  setTimeout(()=>$(!$("#pFirst").value?"#pFirst":"#pPhone").focus(),60);
}
function closeProfile(){$("#pmodal").classList.remove("show");overlay.classList.remove("show");profileLocked=false}
$("#pCancel").onclick=closeProfile;
["#pFirst","#pLast","#pPhone"].forEach((id,i,arr)=>$(id).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();i<arr.length-1?$(arr[i+1]).focus():$("#pOk").click()}});
$("#pOk").onclick=async()=>{
  const f=cap($("#pFirst").value).slice(0,30),l=cap($("#pLast").value).slice(0,30),ph=normPhone($("#pPhone").value);
  if(!f){$("#pErr").textContent="Adını yaz";$("#pFirst").focus();return}
  if(!l){$("#pErr").textContent="Soyadını yaz";$("#pLast").focus();return}
  if(!ph){$("#pErr").textContent="Geçerli bir telefon numarası yaz (örn. 0532 123 45 67)";$("#pPhone").focus();return}
  if(hasBad(f)||hasBad(l)){$("#pErr").textContent="Ad ve soyadında uygunsuz kelime olamaz";return}
  if(pFirstTime&&!$("#pTerms").checked){$("#pErr").textContent="Devam etmek için kullanım koşullarını ve gizlilik politikasını kabul et";return}
  $("#pOk").disabled=true;$("#pErr").textContent="";
  let ok=true;
  try{
    if(ph!==myPhone){const old=myPhone;await setDoc(privRef(),{phone:ph},{merge:true});myPhone=ph;await syncPhone(old)}
    const patch={first:f,last:l,nick:f+" "+l,pub:myPub};
    if(!/^\d{6}$/.test(users[me]?.code||""))patch.code=await claimCode();
    ok=await saveMe(patch);
  }catch(e){ok=false}
  $("#pOk").disabled=false;
  if(!ok){$("#pErr").textContent="Kaydedilemedi, internetini kontrol edip tekrar dene";return}
  closeProfile();updateIdLabel();
  if(pFirstTime)showMyId(`<b>Hoş geldin ${esc(f)}!</b> Bu senin ID'n:<br><br>`);
  else toast("Profil kaydedildi");
};
function askStatus(){
  openModal({title:"Durum paylaş",text:"24 saat boyunca kişilerin görür.",placeholder:"Ne düşünüyorsun?",ok:"Paylaş"},async v=>{
    const bgs=["#1E3A8A","#7C2D12","#14532D","#6B21A8","#9F1239","#0F766E"];
    if(hasBad(v)){toast("Durumunda uygunsuz kelime var",3000);return}
    const s={text:v.slice(0,300),at:Date.now(),bg:bgs[Math.floor(Math.random()*bgs.length)]};
    const prev=statuses[me];statuses[me]=s;renderStatus();
    try{await setDoc(doc(fs,"statuses",me),s);toast("Durumun paylaşıldı ✓")}catch(e){statuses[me]=prev;renderStatus();toast("Paylaşılamadı")}});
}

/* ---------- story ---------- */
let storyTimer;
function openStory(uid){const s=statuses[uid];if(!s)return;
  $("#sAvWrap").innerHTML=avHTML(uid,{size:38});$("#sName").textContent=uid===me?"Durumum":realName(uid);
  $("#sTime").textContent=when(s.at);$("#sBody").textContent=s.text;
  $("#story").style.background=s.bg||"#111";$("#story").classList.add("show");
  const bar=$("#storyBar");bar.style.transition="none";bar.style.width="0";
  requestAnimationFrame(()=>requestAnimationFrame(()=>{bar.style.transition="width 5s linear";bar.style.width="100%"}));
  try{const seen=JSON.parse(localStorage.getItem("tr-seen")||"{}");seen[uid]=s.at;localStorage.setItem("tr-seen",JSON.stringify(seen))}catch(e){}
  clearTimeout(storyTimer);storyTimer=setTimeout(closeStory,5000)}
function closeStory(){clearTimeout(storyTimer);$("#story").classList.remove("show");renderStatus()}
$("#story").onclick=closeStory;

/* ---------- yazı / emoji ---------- */
$("#emojis").innerHTML=EMOJI.map(e=>`<button type="button">${e}</button>`).join("");
$("#emojiBtn").onclick=()=>$("#emojis").classList.toggle("show");
$("#emojis").onclick=e=>{if(e.target.tagName==="BUTTON"){$("#msgInput").value+=e.target.textContent;updateSendIcon();$("#msgInput").focus()}};
function updateSendIcon(){const has=!!$("#msgInput").value.trim();$("#icoSend").style.display=has?"":"none";$("#icoMic").style.display=has?"none":"";$("#sendBtn").setAttribute("aria-label",has?"Gönder":"Sesli mesaj kaydet")}
$("#msgInput").addEventListener("input",updateSendIcon);
$("#composer").onsubmit=async e=>{e.preventDefault();
  const v=$("#msgInput").value.trim();if(!cur||!me)return;
  if(!v){startRec();return}
  $("#msgInput").value="";updateSendIcon();$("#emojis").classList.remove("show");
  const ok=await sendContent(cur,{t:"text",text:v.slice(0,2000)});
  if(!ok&&!$("#msgInput").value){$("#msgInput").value=v;updateSendIcon()}
  $("#msgInput").focus();
};

/* ---------- fotoğraf ---------- */
$("#photoBtn").onclick=()=>$("#photoInput").click();
$("#photoInput").onchange=async e=>{
  const f=e.target.files&&e.target.files[0];e.target.value="";if(!f||!cur)return;
  if(!f.type.startsWith("image/")){toast("Lütfen bir fotoğraf seç");return}
  const conv=cur;
  try{
    toast("Fotoğraf hazırlanıyor…",1500);
    const {blob,w,h}=await compressImage(f,1600,0.82);
    if(blob.size>CHUNK*8){toast("Fotoğraf çok büyük");return}
    await sendContent(conv,{t:"img"},{blob,mime:blob.type,meta:{w,h}});
  }catch(err){toast("Fotoğraf açılamadı")}
};
async function compressImage(file,maxSide,q){
  let bmp;
  try{bmp=await createImageBitmap(file,{imageOrientation:"from-image"})}
  catch(e){bmp=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(file)})}
  const sw=bmp.width,sh=bmp.height,sc=Math.min(1,maxSide/Math.max(sw,sh));
  const w=Math.round(sw*sc),h=Math.round(sh*sc);
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);ctx.drawImage(bmp,0,0,w,h);
  const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",q));
  if(!blob)throw new Error("toBlob");
  return{blob,w,h};
}

/* ---------- sesli mesaj ---------- */
let rec=null;
function pickMime(){const c=["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/mp4","audio/webm"];for(const m of c){try{if(window.MediaRecorder&&MediaRecorder.isTypeSupported(m))return m}catch(e){}}return""}
async function startRec(){
  if(rec||!cur)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("Bu cihaz ses kaydını desteklemiyor");return}
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
  catch(e){toast("Mikrofon izni verilmedi. Ayarlardan TR'ye mikrofon izni ver.",3500);return}
  const mime=pickMime();
  let mr;try{mr=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:24000}:{})}catch(e){mr=new MediaRecorder(stream)}
  const chunks=[];const conv=cur;
  rec={mr,stream,chunks,conv,start:Date.now(),send:false,timer:null};
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  mr.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    const r=rec;rec=null;clearInterval(r.timer);
    $("#recbar").classList.remove("show");$("#composer").style.display="";
    if(!r.send)return;
    const dur=Math.round((Date.now()-r.start)/1000);
    if(dur<1){toast("Kayıt çok kısa");return}
    const type=(mr.mimeType||mime||"audio/webm").split(";")[0];
    const blob=new Blob(chunks,{type});
    await sendContent(r.conv,{t:"voice",dur},{blob,mime:type});
  };
  mr.start(1000);
  $("#composer").style.display="none";$("#recbar").classList.add("show");$("#recTime").textContent="0:00";
  rec.timer=setInterval(()=>{const s=(Date.now()-rec.start)/1000;$("#recTime").textContent=fmtDur(s);if(s>=MAX_VOICE_SEC)stopRec(true)},250);
}
function stopRec(send){if(!rec)return;rec.send=send;try{rec.mr.stop()}catch(e){}}
$("#recCancel").onclick=()=>stopRec(false);
$("#recSend").onclick=()=>stopRec(true);

/* ---------- giriş / çıkış ---------- */
const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:"select_account"});
$("#googleBtn").onclick=async()=>{
  $("#loginErr").textContent="";
  try{await signInWithPopup(auth,provider)}
  catch(e){
    if(e&&(e.code==="auth/popup-blocked"||e.code==="auth/operation-not-supported-in-this-environment"||e.code==="auth/cancelled-popup-request")){try{await signInWithRedirect(auth,provider)}catch(e2){$("#loginErr").textContent="Giriş yapılamadı: "+(e2.code||e2.message)}}
    else if(e&&e.code!=="auth/popup-closed-by-user")$("#loginErr").textContent="Giriş yapılamadı: "+(e.code||e.message);
  }
};
getRedirectResult(auth).catch(e=>{$("#loginErr").textContent="Giriş yapılamadı: "+(e.code||e.message)});

async function logout(){
  toast("Çıkış yapılıyor…",4000);
  stopAll();me=null;ready=false;cur=null;
  try{await Promise.race([signOut(auth),new Promise(r=>setTimeout(r,3000))])}catch(e){}
  try{Object.keys(localStorage).filter(k=>k.startsWith("firebase:")).forEach(k=>localStorage.removeItem(k))}catch(e){}
  try{Object.keys(sessionStorage).filter(k=>k.startsWith("firebase:")).forEach(k=>sessionStorage.removeItem(k))}catch(e){}
  try{await new Promise(r=>{const q=indexedDB.deleteDatabase("firebaseLocalStorageDb");q.onsuccess=q.onerror=q.onblocked=()=>r();setTimeout(r,1500)})}catch(e){}
  location.replace("/?cikis="+Date.now());
}
function stopAll(){unsubs.forEach(u=>{try{u()}catch(e){}});unsubs=[];watched.clear();friends={};blocked={};myBan=null;renderBan()}

const watched=new Set();
function watchUser(uid){
  if(!uid||watched.has(uid)||!me)return;watched.add(uid);
  unsubs.push(onSnapshot(doc(fs,"users",uid),s=>{if(s.exists()){users[uid]=cleanUser(s.data());decryptAll();renderAll();if(uid===me)updateIdLabel()}},()=>{}));
  unsubs.push(onSnapshot(doc(fs,"badges",uid),s=>{const v=s.exists()?+s.data().vipUntil||0:0;if((vipU[uid]||0)!==v){vipU[uid]=v;renderAll()}},()=>{}));
  unsubs.push(onSnapshot(doc(fs,"statuses",uid),s=>{const x=s.exists()?s.data():null;if(x&&x.text)statuses[uid]={text:cleanText(String(x.text).slice(0,300)),at:+x.at||0,bg:/^#[0-9a-fA-F]{6}$/.test(x.bg)?x.bg:"#111"};else delete statuses[uid];renderStatus()},()=>{}));
}

onAuthStateChanged(auth,async u=>{
  stopAll();
  if(!u){me=null;ready=false;$("#login").classList.add("show");$("#splash").classList.remove("show");return}
  meUser=u;me=u.uid;
  $("#login").classList.remove("show");$("#splash").classList.add("show");
  try{await initKeys()}catch(e){$("#splash").classList.remove("show");banner("Bağlantı kurulamadı. İnternetini kontrol edip sayfayı yenile.");return}
  ready=true;$("#splash").classList.remove("show");
  try{const s=await getDoc(doc(fs,"users",me));if(s.exists())users[me]=cleanUser(s.data())}catch(e){}
  const mineU=users[me];
  if(!mineU||!mineU.first||!mineU.last||!myPhone||!mineU.code)askProfile(true);
  else if(!mineU.pub||mineU.pub.x!==myPub.x||mineU.pub.y!==myPub.y)saveMe({pub:myPub});
  updateIdLabel();renderAll();
  syncPhone().catch(()=>{});
  setupPush(false).catch(()=>{});
  initWallet();

  watchUser(me);
  unsubs.push(onSnapshot(query(collection(fs,"blocks"),where("by","==",me)),s=>{
    const next={};s.docs.forEach(d=>{const t=d.data()?.target;if(typeof t==="string")next[t]=true});blocked=next;renderAll();
  },()=>{}));
  unsubs.push(onSnapshot(doc(fs,"bans",me),s=>{const b=s.exists()?s.data():null;myBan=b&&+b.until>Date.now()?{until:+b.until,reason:String(b.reason||"")}:null;renderBan()},()=>{}));
  unsubs.push(onSnapshot(query(collection(fs,"friends"),where("members","array-contains",me)),s=>{
    const next={};
    s.docs.forEach(d=>{const x=d.data()||{};if(!Array.isArray(x.members))return;const p=x.members.find(u=>u!==me);if(!p)return;
      next[p]={id:d.id,members:x.members,from:String(x.from||""),to:String(x.to||""),status:String(x.status||""),at:+x.at||0};watchUser(p)});
    friends=next;renderAll();
  },()=>{}));
  unsubs.push(onSnapshot(contactsRef(),s=>{const x=s.exists()?s.data():null;contacts=Array.isArray(x?.list)?x.list.filter(v=>typeof v==="string"):[];contacts.forEach(watchUser);renderAll()},()=>{}));
  unsubs.push(onSnapshot(query(collection(fs,"groups"),where("members","array-contains",me)),s=>{
    const next={};s.docs.forEach(d=>{const g=cleanGroup(d.data());if(g&&g.members.includes(me)){next[d.id]=g;g.members.forEach(watchUser)}});
    groups=next;
    if(cur&&isGroupConv(cur)&&!groups[gidOf(cur)])renderMsgs();
    decryptAll();renderAll();
  },()=>{}));
  unsubs.push(onSnapshot(query(collection(fs,"msgs"),where("members","array-contains",me)),s=>{
    raw=s.docs.map(d=>{const x=d.data()||{};return{id:d.id,from:String(x.from||""),to:typeof x.to==="string"?x.to:"",gid:typeof x.gid==="string"?x.gid:"",keys:x.keys&&typeof x.keys==="object"?x.keys:null,at:+x.at||0,iv:String(x.iv||""),ct:String(x.ct||"")}})
      .filter(m=>m.iv&&m.ct&&m.from&&(m.gid||(m.to&&m.from!==m.to&&(m.from===me||m.to===me))));
    raw.forEach(m=>{watchUser(m.from);if(m.to)watchUser(m.to)});
    pending=pending.filter(p=>!raw.find(m=>m.id===p.id));
    banner("");
    if(cur)markRead(cur);
    decryptAll();renderAll();
    notifyNew(s);
    openPendingDeepLink();
  },err=>{banner("Mesajlar yüklenemedi: "+(err.code||err.message))}));
  unsubs.push(onSnapshot(query(collection(fs,"calls"),where("members","array-contains",me)),s=>{
    const next={};s.docs.forEach(d=>{const x=d.data();if(!x||!x.from||!x.to)return;next[d.id]={from:x.from,to:x.to,video:!!x.video,state:String(x.state||""),at:+x.at||0,answeredAt:+x.answeredAt||0,endedAt:+x.endedAt||0,offer:x.offer||null};watchUser(x.from===me?x.to:x.from)});
    callLog=next;
    s.docChanges().forEach(ch=>{if(ch.type!=="removed"){const x=next[ch.doc.id];if(x)onIncoming(ch.doc.id,x)}});
    if(pendingCallId&&next[pendingCallId]){onIncoming(pendingCallId,next[pendingCallId]);pendingCallId=null}
    renderCalls();
  },()=>{}));
  unsubs.push(onSnapshot(query(collection(fs,"reads"),where("members","array-contains",me)),s=>{
    s.docs.forEach(d=>{const x=d.data();if(x&&typeof x.at==="number"){if(d.id.startsWith(me+"_"))reads[d.id]=Math.max(reads[d.id]||0,x.at);else reads[d.id]=x.at}});
    renderAll()},()=>{}));
});

/* ---------- sesli / görüntülü arama (WebRTC) ---------- */
// Sinyal: calls/{id} belgesi (offer/answer/durum) + calls/{id}/cands (ICE adayları). Medya iki cihaz arasında doğrudan,
// DTLS-SRTP ile şifreli akar. TURN gerekirse /api/turn kısa ömürlü kimlik bilgisi verir.
let callLog={};          // id -> çağrı belgesi (geçmiş)
let call=null;           // etkin çağrı
let iceCache=null;
const RING_MS=45000;
async function iceServers(){
  if(iceCache&&iceCache.exp>Date.now())return iceCache.list;
  let list=[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}];
  try{const r=await callApi("/api/turn",{});if(Array.isArray(r.iceServers)&&r.iceServers.length)list=list.concat(r.iceServers)}catch(e){}
  iceCache={list,exp:Date.now()+30*60*1000};return list;
}
function callPeer(c){return c.from===me?c.to:c.from}
function renderCalls(){
  if(!ready)return;
  const list=Object.entries(callLog).map(([id,c])=>({id,...c})).sort((a,b)=>b.at-a.at).slice(0,100);
  const ico=v=>v?'<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>':'<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>';
  $("#pane-calls").innerHTML=list.length?`<div class="section">Son aramalar</div>`+list.map(c=>{
    const p=callPeer(c),out=c.from===me,missed=!out&&(c.state==="missed"||c.state==="declined"&&!c.answeredAt);
    const dur=c.answeredAt&&c.endedAt?" · "+fmtDur((c.endedAt-c.answeredAt)/1000):"";
    return`<div class="row callrow" data-callback="${esc(p)}" data-video="${c.video?1:0}">${avHTML(p)}<div class="meta" style="display:flex;align-items:center;gap:10px"><div style="flex:1;min-width:0"><div class="name ${missed?"miss":""}">${esc(realName(p))}</div><div class="prev"><span class="dir ${missed?"miss":""}" style="color:${missed?"":"var(--brand)"}">${out?"↗":"↙"}</span>${when(c.at)}${dur}</div></div><svg class="ci" viewBox="0 0 24 24">${ico(c.video)}</svg></div></div>`}).join("")
    :`<div class="empty">Henüz arama yok.<br>Bir sohbeti açıp üstteki 📞 ya da 🎥 simgesine dokun.</div>`;
}
let ringCtx=null,ringTimer=null;
function startRing(incoming){
  stopRing();
  try{
    ringCtx=new (window.AudioContext||window.webkitAudioContext)();
    const beep=()=>{if(!ringCtx)return;const o=ringCtx.createOscillator(),g=ringCtx.createGain();o.type="sine";o.frequency.value=incoming?880:440;g.gain.value=0.0001;o.connect(g);g.connect(ringCtx.destination);const t=ringCtx.currentTime;g.gain.exponentialRampToValueAtTime(incoming?0.25:0.12,t+0.05);g.gain.exponentialRampToValueAtTime(0.0001,t+(incoming?0.9:1.4));o.start(t);o.stop(t+1.5)};
    beep();ringTimer=setInterval(beep,incoming?2000:3000);
  }catch(e){}
  if(incoming&&navigator.vibrate)try{navigator.vibrate([400,300,400,300,400])}catch(e){}
}
function stopRing(){clearInterval(ringTimer);ringTimer=null;if(ringCtx){try{ringCtx.close()}catch(e){}ringCtx=null}if(navigator.vibrate)try{navigator.vibrate(0)}catch(e){}}
function showCallScreen(){
  const c=call;if(!c)return;
  const el=$("#callscr");el.classList.add("show");el.classList.toggle("vid",!!c.video);
  $("#csAv").innerHTML=avHTML(c.peer);$("#csName").textContent=realName(c.peer);
  updateCallUI();
}
function updateCallUI(){
  const c=call;if(!c)return;
  $("#csAv").innerHTML=avHTML(c.peer);$("#csName").textContent=realName(c.peer);
  const st={dialing:"Aranıyor…",ringing:c.video?"Görüntülü arama geliyor…":"Sesli arama geliyor…",connecting:"Bağlanıyor…",live:"",ended:"Arama sona erdi"}[c.phase]||"";
  if(c.phase==="live"){clearInterval(c.tick);const f=()=>{$("#csState").textContent=fmtDur((Date.now()-c.liveAt)/1000)};f();c.tick=setInterval(f,1000)}
  else $("#csState").textContent=st;
  $("#callscr").classList.toggle("live",c.phase==="live");
  $("#callscr").classList.toggle("inc",c.phase==="ringing");
  $("#csIncoming").classList.toggle("show",c.phase==="ringing");
  $("#csActive").classList.toggle("show",c.phase!=="ringing"&&c.phase!=="ended");
  $("#csCam").style.display=c.video?"":"none";$("#csFlip").style.display=c.video?"":"none";
}
async function getMedia(video,facing="user"){
  return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:video?{facingMode:facing,width:{ideal:640},height:{ideal:480}}:false});
}
function attachLocal(stream){const v=$("#localVideo");v.srcObject=stream;v.play().catch(()=>{})}
async function makePC(id,role){
  const pc=new RTCPeerConnection({iceServers:await iceServers()});
  const remote=new MediaStream();
  pc.ontrack=e=>{remote.addTrack(e.track);const rv=$("#remoteVideo"),ra=$("#remoteAudio");if(call&&call.video){rv.srcObject=remote;rv.play().catch(()=>{})}ra.srcObject=remote;ra.play().catch(()=>{})};
  // Arama belgesi sunucuda oluşmadan aday yazılırsa kurallar reddeder: o yüzden belge hazır olana kadar biriktir
  const outQ=[];let docReady=role==="callee";
  const sendCand=c=>setDoc(doc(collection(fs,"calls",id,"cands")),{by:me,c,at:Date.now()}).catch(()=>setTimeout(()=>setDoc(doc(collection(fs,"calls",id,"cands")),{by:me,c,at:Date.now()}).catch(()=>{}),1500));
  pc.onicecandidate=e=>{if(!e.candidate)return;const c=e.candidate.toJSON();if(docReady)sendCand(c);else outQ.push(c)};
  const markReady=()=>{docReady=true;while(outQ.length)sendCand(outQ.shift())};
  pc.onconnectionstatechange=()=>{
    if(!call||call.pc!==pc)return;
    if(pc.connectionState==="connected"&&call.phase!=="live"){call.phase="live";call.liveAt=Date.now();stopRing();updateCallUI()}
    if(pc.connectionState==="failed"||pc.iceConnectionState==="failed"){toast("Bağlantı kurulamadı",3000);endCall("failed")}
  };
  const pendingCands=[];
  const unsub=onSnapshot(collection(fs,"calls",id,"cands"),s=>{
    s.docs.forEach(d=>{const x=d.data();if(!x||x.by===me||call?.seenCands?.has(d.id))return;call&&call.seenCands.add(d.id);
      if(pc.remoteDescription)pc.addIceCandidate(x.c).catch(()=>{});else pendingCands.push(x.c)});
  },()=>{});
  const flush=()=>{while(pendingCands.length)pc.addIceCandidate(pendingCands.shift()).catch(()=>{})};
  return{pc,unsub,flush,markReady};
}
async function startCall(peer,video){
  if(call){toast("Zaten bir arama var");return}
  if(isGroupConv(peer)){toast("Grup araması henüz yok");return}
  if(!isFriend(peer)){toast("Aramak için önce arkadaş olmalısınız");return}
  if(!window.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia){toast("Bu cihaz aramayı desteklemiyor");return}
  let stream;
  try{stream=await getMedia(video)}catch(e){toast(video?"Kamera/mikrofon izni verilmedi":"Mikrofon izni verilmedi",3500);return}
  const ref=doc(collection(fs,"calls"));
  call={id:ref.id,peer,video,role:"caller",phase:"dialing",stream,facing:"user",seenCands:new Set(),unsubs:[]};
  if(video)attachLocal(stream);
  showCallScreen();startRing(false);
  try{
    const {pc,unsub,flush,markReady}=await makePC(ref.id,"caller");call.pc=pc;call.unsubs.push(unsub);
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    await setDoc(ref,{from:me,to:peer,members:[me,peer],video:!!video,state:"ringing",at:Date.now(),offer:{type:offer.type,sdp:offer.sdp}});
    markReady();
    callApi("/api/notify",{call:ref.id}).catch(()=>{});
    call.unsubs.push(onSnapshot(ref,s=>{
      const d=s.data();if(!d||!call||call.id!==ref.id)return;
      if(d.answer&&!pc.currentRemoteDescription){pc.setRemoteDescription(d.answer).then(flush).catch(()=>{});call.phase="connecting";stopRing();updateCallUI()}
      if(d.state==="declined"){toast(realName(peer)+" aramayı reddetti",3000);endCall(null)}
      else if(d.state==="ended")endCall(null);
    },()=>{}));
    call.timeout=setTimeout(()=>{if(call&&call.id===ref.id&&call.phase==="dialing"){toast("Cevap yok",2500);endCall("missed")}},RING_MS);
  }catch(e){toast("Arama başlatılamadı");endCall("failed")}
}
const handledCalls=new Set();
function onIncoming(id,d){
  if(call||handledCalls.has(id)||d.to!==me||d.state!=="ringing"||Date.now()-d.at>RING_MS)return;
  handledCalls.add(id);
  call={id,peer:d.from,video:!!d.video,role:"callee",phase:"ringing",offer:d.offer,seenCands:new Set(),unsubs:[],facing:"user"};
  showCallScreen();startRing(true);
  if(!users[d.from]||!users[d.from].nick)getDoc(doc(fs,"users",d.from)).then(s=>{if(s.exists()){users[d.from]=cleanUser(s.data());updateCallUI()}}).catch(()=>{});
  call.unsubs.push(onSnapshot(doc(fs,"calls",id),s=>{const x=s.data();if(!x||!call||call.id!==id)return;if(x.state==="ended"||x.state==="missed"){if(call.phase==="ringing")toast("Cevapsız arama",2500);endCall(null)}},()=>{}));
  call.timeout=setTimeout(()=>{if(call&&call.id===id&&call.phase==="ringing")endCall(null)},RING_MS);
}
async function acceptCall(){
  const c=call;if(!c||c.phase!=="ringing")return;
  stopRing();c.phase="connecting";updateCallUI();
  try{c.stream=await getMedia(c.video)}catch(e){toast("Mikrofon/kamera izni verilmedi",3500);declineCall();return}
  if(c.video)attachLocal(c.stream);
  try{
    const {pc,unsub,flush}=await makePC(c.id,"callee");c.pc=pc;c.unsubs.push(unsub);
    c.stream.getTracks().forEach(t=>pc.addTrack(t,c.stream));
    await pc.setRemoteDescription(c.offer);flush();
    const ans=await pc.createAnswer();await pc.setLocalDescription(ans);
    await setDoc(doc(fs,"calls",c.id),{answer:{type:ans.type,sdp:ans.sdp},state:"accepted",answeredAt:Date.now()},{merge:true});
  }catch(e){toast("Arama bağlanamadı");endCall("failed")}
}
async function declineCall(){
  const c=call;if(!c)return;
  try{await setDoc(doc(fs,"calls",c.id),{state:"declined",endedAt:Date.now()},{merge:true})}catch(e){}
  endCall(null);
}
async function endCall(state){
  const c=call;if(!c)return;call=null;
  stopRing();clearTimeout(c.timeout);clearInterval(c.tick);
  c.unsubs.forEach(u=>{try{u()}catch(e){}});
  try{c.pc&&c.pc.close()}catch(e){}
  try{c.stream&&c.stream.getTracks().forEach(t=>t.stop())}catch(e){}
  $("#remoteVideo").srcObject=null;$("#localVideo").srcObject=null;$("#remoteAudio").srcObject=null;
  $("#callscr").classList.remove("show","vid","live","back");
  if(state!==null){
    const patch={state:state||"ended",endedAt:Date.now()};
    try{await setDoc(doc(fs,"calls",c.id),patch,{merge:true})}catch(e){}
  }
}
$("#csAccept").onclick=acceptCall;
$("#csDecline").onclick=declineCall;
$("#csHang").onclick=()=>endCall(call&&call.phase==="dialing"?"missed":"ended");
$("#csMute").onclick=()=>{if(!call||!call.stream)return;const t=call.stream.getAudioTracks()[0];if(!t)return;t.enabled=!t.enabled;$("#csMute").classList.toggle("on",!t.enabled)};
$("#csCam").onclick=()=>{if(!call||!call.stream)return;const t=call.stream.getVideoTracks()[0];if(!t)return;t.enabled=!t.enabled;$("#csCam").classList.toggle("on",!t.enabled)};
$("#csFlip").onclick=async()=>{
  const c=call;if(!c||!c.video||!c.stream)return;
  const facing=c.facing==="user"?"environment":"user";
  try{
    const ns=await navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:640},height:{ideal:480}}});
    const nt=ns.getVideoTracks()[0],ot=c.stream.getVideoTracks()[0];
    const sender=c.pc&&c.pc.getSenders().find(s=>s.track&&s.track.kind==="video");
    if(sender)await sender.replaceTrack(nt);
    if(ot){c.stream.removeTrack(ot);ot.stop()}c.stream.addTrack(nt);c.facing=facing;
    attachLocal(c.stream);$("#callscr").classList.toggle("back",facing==="environment");
  }catch(e){toast("Kamera çevrilemedi")}
};
$("#acallBtn").onclick=()=>cur&&startCall(cur,false);
$("#vcallBtn").onclick=()=>cur&&startCall(cur,true);
window.addEventListener("beforeunload",()=>{if(call)endCall(call.phase==="dialing"?"missed":"ended")});

/* ---------- jeton, seviye, sıralama, mağaza, yönetim ---------- */
// Bakiye sadece sunucuda değişir; burada sadece gösterilir. Jeton paraya çevrilemez, başkasına gönderilemez.
let wallet=null,catalog=null,isAdminUser=false,houseStats=null;
const fmtCoin=n=>(n||0).toLocaleString("tr-TR");
function levelFromXp(xp){let lvl=1,need=200,acc=0;while(xp>=acc+need&&lvl<50){acc+=need;lvl++;need=Math.round(need*1.35)}return{level:lvl,cur:xp-acc,next:need}}
function trDay(ms=Date.now()){const d=new Date(ms+3*3600*1000);return{day:`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`,month:`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}`}}
async function initWallet(){
  try{const r=await callApi("/api/wallet",{action:"me"});catalog=r.wallet.catalog;applyWallet(r.wallet);if(r.welcomed)setTimeout(()=>openInfoModal("🎁 Hoş geldin!",`<div style="text-align:center;font-size:15px;line-height:1.5"><div style="font-size:44px">🎉</div>Sana <b>${fmtCoin(100000)}</b> <span class="coin"></span> jeton hediye ettik.<br>Oyun sekmesinden harcayabilirsin.</div>`),1500)}catch(e){}
  unsubs.push(onSnapshot(doc(fs,"wallets",me),s=>{if(!s.exists())return;const x=s.data();const lv=levelFromXp(x.xp||0);applyWallet({...(wallet||{}),balance:x.balance||0,xp:x.xp||0,level:lv.level,levelCur:lv.cur,levelNext:lv.next,wins:x.wins||0,games:x.games||0,owned:x.owned,skin:x.skin,vipUntil:+x.vipUntil||0,adult:!!x.adult,ageSet:!!x.birthYear})},()=>{}));
  callApi("/api/admin",{action:"check"}).then(r=>{isAdminUser=!!(r&&r.admin);houseStats=r&&r.house;renderGamesTab()}).catch(()=>{});
}
function applyWallet(w){wallet=w;if(w&&w.vipUntil!=null&&me)vipU[me]=Math.max(vipU[me]||0,+w.vipUntil||0);renderGamesTab();if(game)renderGame()}
function mySkin(kind){const id=wallet?.skin?.[kind]||(kind==="table"?"yesil":"ceviz");if(id.startsWith("vip_")&&!isVipU(me))return kind==="table"?"yesil":"ceviz";return id}

/* ---------- VIP ---------- */
function openVip(){
  const v=catalog?.vip||{price:250000,days:30},on=isVipU(me);
  const perks=[["👑","Adının yanında VIP tacı","Sohbetlerde, masada ve sıralamada herkes görür"],["🎨","VIP masa ve ıstaka desenleri","Kraliyet moru, beyaz mermer, altın işlemeli, sedef, elmas"],["👀","Profilimi kimler gördü","Son 30 günde profiline bakanların listesi"]];
  openInfoModal("👑 TR VIP",`<div class="vipcard"><div class="vt">${on?"VIP üyeliğin aktif":"VIP ol, farkını göster"}</div><div class="vs">${on?esc(new Date(vipU[me]).toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"}))+" tarihine kadar":v.days+" gün · "+fmtCoin(v.price)+" jeton"}</div></div>
    ${perks.map(p=>`<div class="pk"><span style="font-size:26px">${p[0]}</span><div><b style="font-size:15px">${p[1]}</b><div class="isub">${p[2]}</div></div></div>`).join("")}
    <div class="row2" style="margin-top:10px"><button id="vipBuy" class="vipbuy">${on?"30 gün uzat":"VIP ol"} · ${fmtCoin(v.price)} <span class="coin"></span></button></div>
    <div class="row2"><button id="vipViews" class="neg" style="background:var(--bg);color:var(--text)">👀 Profilimi kimler gördü</button></div>`);
  $("#vipViews").onclick=openViews;
  $("#vipBuy").onclick=async()=>{
    if(!wallet?.adult){closeE();if(wallet?.ageSet)toast("VIP 18 yaş üstüne açık",3000);else askAge(openVip);return}
    if((wallet?.balance||0)<v.price){toast("Yeterli jetonun yok");return}
    $("#vipBuy").disabled=true;
    try{const r=await callApi("/api/wallet",{action:"buyVip"});applyWallet({...r.wallet});catalog=r.wallet.catalog;vipU[me]=r.wallet.vipUntil;renderAll();openVip();toast("👑 VIP oldun!",3000)}
    catch(e){toast(e.status===402?"Yeterli jetonun yok":"İşlem yapılamadı");$("#vipBuy").disabled=false}
  };
}
async function openViews(){
  openInfoModal("👀 Profilimi kimler gördü",'<div class="empty">Yükleniyor…</div>');
  let r;try{r=await callApi("/api/wallet",{action:"views"})}catch(e){$("#eBody").innerHTML='<div class="empty">Yüklenemedi</div>';return}
  if(!r.vip){
    $("#eBody").innerHTML=`<div class="vipcard"><div class="vt">Son 30 günde ${fmtCoin(r.count||0)} kişi profiline baktı</div><div class="vs">Kim olduklarını görmek için VIP ol</div></div><div class="row2" style="margin-top:10px"><button id="vGo" class="vipbuy">👑 VIP ol</button></div>`;
    $("#vGo").onclick=openVip;return;
  }
  (r.list||[]).forEach(x=>watchUser(x.uid));
  for(const x of r.list||[])if(!users[x.uid]){try{const u=await getDoc(doc(fs,"users",x.uid));if(u.exists())users[x.uid]=cleanUser(u.data())}catch(e){}}
  $("#eBody").innerHTML=(r.list||[]).length?`<div class="isub" style="margin-bottom:6px">Son 30 gün · ${r.list.length} kişi</div>`+r.list.map(x=>`<div class="gitem" data-vopen="${esc(x.uid)}">${avHTML(x.uid)}<div class="gn"><b>${esc(realName(x.uid))}${vipMark(x.uid)}</b><span>${when(x.at)}</span></div></div>`).join(""):'<div class="empty">Son 30 günde profiline bakan olmadı</div>';
  $("#eBody").onclick=e=>{const g=e.target.closest("[data-vopen]");if(g){closeE();openChat(g.dataset.vopen)}};
}
const viewedAt={};
function recordView(u){
  if(!u||u===me||isGroupConv(u))return;
  if(Date.now()-(viewedAt[u]||0)<3600e3)return;viewedAt[u]=Date.now();
  setDoc(doc(fs,"profile_views",u,"v",me),{at:Date.now()}).catch(()=>{});
}
function renderGamesTab(){
  const el=$("#pane-games");if(!el||!ready)return;
  if(!wallet){el.innerHTML='<div class="empty">Yükleniyor…</div>';return}
  const pct=Math.min(100,Math.round(100*(wallet.levelCur||0)/(wallet.levelNext||1)));
  el.innerHTML=`<div class="wcard"><div style="font-size:13px;opacity:.85">Jeton bakiyen</div><div class="bal"><span class="coin"></span>${fmtCoin(wallet.balance)}</div>
    <div class="lv"><b>Seviye ${wallet.level}</b><div class="bar"><i style="width:${pct}%"></i></div><span>${fmtCoin(wallet.levelCur)}/${fmtCoin(wallet.levelNext)} XP</span></div>
    <div class="st">${(()=>{const t=(catalog?.tiers||[])[tierIdx(wallet.balance)];return t?`${t.icon} <b>${esc(t.name)}</b> · `:""})()}${wallet.wins||0} galibiyet · ${wallet.games||0} oyun<br>Bakiyen arttıkça üst salonlar açılır. Seviye atladıkça bilgisayar rakipler zorlaşır.</div></div>
  <div class="gbtns">
    <button data-g="play"><span>🀄</span>Okey oyna</button>
    <button data-g="store"><span>🪙</span>Jeton al</button>
    <button data-g="rank"><span>🏆</span>Sıralama</button>
    <button data-g="skins"><span>🎨</span>Masa ve ıstaka</button>
    <button data-g="vip" class="vipbtn" style="grid-column:span 2"><span>👑</span>${isVipU(me)?"VIP üyesin · "+new Date(vipU[me]).toLocaleDateString("tr-TR")+" tarihine kadar":"VIP ol"}</button>
    ${isAdminUser?'<button data-g="admin" style="grid-column:span 2"><span>🛠️</span>Yönetim paneli</button>':""}
  </div>
  <div class="empty" style="padding:6px 20px 30px;font-size:12.5px">Jetonlar sadece oyun içinde kullanılır; paraya çevrilemez ve başkasına gönderilemez.</div>`;
}
document.querySelector(".content").addEventListener("click",e=>{const b=e.target.closest("[data-g]");if(!b)return;const g=b.dataset.g;
  if(g==="play"){openInfoModal("Okey oyna","Okey bir sohbetin içinde oynanır. Bir kişi ya da grup sohbeti aç, üstteki 🎮 düğmesine dokun.");}
  if(g==="store")openStore();if(g==="rank")openRanking("day");if(g==="skins")openSkins();if(g==="admin")openAdmin();if(g==="vip")openVip()});
function openInfoModal(title,html){closeAll();$("#eTitle").textContent=title;$("#eBody").innerHTML=html;overlay.classList.add("show");$("#emodal").classList.add("show")}
function closeE(){$("#emodal").classList.remove("show");overlay.classList.remove("show")}
$("#eClose").onclick=closeE;
function openStore(){
  const pk=(catalog?.packages||[]).map(p=>`<div class="pk"><span class="coin" style="font-size:28px"></span><div><b>${fmtCoin(p.coins)}</b><div class="isub">jeton</div></div><button class="pr" data-buy="${p.id}">${p.price} TL</button></div>`).join("");
  openInfoModal("Jeton al",pk+`<p class="isub" style="margin-top:8px">Ödeme, TR Play Store'da yayınlandığında Google Play üzerinden açılacak. Şimdilik jeton yükleme için yöneticiyle iletişime geç.</p>`);
  $("#eBody").onclick=e=>{if(e.target.closest("[data-buy]"))toast("Ödeme henüz açık değil. Play Store yayınından sonra aktif olacak.",3500)};
}
const SW_COLORS={vip_mor:"linear-gradient(135deg,#4a1a6b,#2a0b40)",vip_mermer:"linear-gradient(135deg,#f4f1ea,#cfc8bb)",vip_altin:"linear-gradient(135deg,#1b3d2a,#c9a43a)",vip_sedef:"linear-gradient(135deg,#f6efe6,#c9d6e8,#e8d3e6)",vip_elmas:"linear-gradient(135deg,#dff3ff,#8fc6e8)",yesil:"#0b5a31",lacivert:"#122a57",bordo:"#64121f",siyah:"#222",ay:"#C8102E",ceviz:"#7c5428",abanoz:"#1e140e",kiraz:"#7a2a22",altin:"#c79a2a"};
function openSkins(){
  const sec=(kind,title)=>`<div class="fl" style="margin-top:6px">${title}</div>`+(catalog?.skins?.[kind]||[]).map(it=>{const own=it.vip?isVipU(me):(wallet.owned?.[kind]||[]).includes(it.id),eq=mySkin(kind)===it.id;
    if(it.vip)return`<div class="pk"><span class="sw" style="background:${SW_COLORS[it.id]||"#888"}"></span><div><b style="font-size:15px">${esc(it.name)}</b><div class="isub">👑 VIP'e özel</div></div><button class="pr ${eq?"eq":own?"own":"vipx"}" data-skin="${kind}:${it.id}" ${eq?"disabled":""}>${eq?"Kullanılıyor":own?"Kullan":"VIP ol"}</button></div>`;
    return`<div class="pk"><span class="sw" style="background:${SW_COLORS[it.id]||"#888"}"></span><div><b style="font-size:15px">${esc(it.name)}</b><div class="isub">${it.price?fmtCoin(it.price)+" jeton":"Ücretsiz"}</div></div><button class="pr ${eq?"eq":own?"own":""}" data-skin="${kind}:${it.id}" ${eq?"disabled":""}>${eq?"Kullanılıyor":own?"Kullan":"Satın al"}</button></div>`}).join("");
  openInfoModal("Masa ve ıstaka",sec("table","Masa deseni")+sec("rack","Istaka"));
  $("#eBody").onclick=async e=>{const b=e.target.closest("[data-skin]");if(!b)return;const [kind,id]=b.dataset.skin.split(":");const own=(wallet.owned?.[kind]||[]).includes(id);
    const it=catalog.skins[kind].find(x=>x.id===id);
    if(it.vip&&!isVipU(me)){openVip();return}
    if(it.vip){b.disabled=true;try{const r=await callApi("/api/wallet",{action:"equip",kind,id});applyWallet({...r.wallet});openSkins();toast("Değiştirildi")}catch(err){toast("İşlem yapılamadı");b.disabled=false}return}
    if(!own&&(wallet.balance||0)<it.price){toast("Yeterli jetonun yok");return}
    b.disabled=true;try{const r=await callApi("/api/wallet",{action:own?"equip":"buySkin",kind,id});applyWallet({...r.wallet});catalog=r.wallet.catalog;openSkins();toast(own?"Değiştirildi":"Satın alındı 🎉")}catch(err){toast("İşlem yapılamadı");b.disabled=false}};
}
let lbUnsub=null;
function openRanking(kind){
  const {day,month}=trDay();const col=kind==="day"?`lb_day/${day}/u`:`lb_month/${month}/u`;
  const prizes=kind==="day"?(catalog?.daily||[100000,50000,20000]):(catalog?.monthly||[1000000,500000,200000]);
  openInfoModal("Sıralama",`<div class="lbtabs"><button data-lb="day" class="${kind==="day"?"on":""}">Günün birincileri</button><button data-lb="month" class="${kind==="month"?"on":""}">Ayın birincileri</button></div><div class="isub" style="margin-bottom:6px">Ödüller: 🥇 ${fmtCoin(prizes[0])} · 🥈 ${fmtCoin(prizes[1])} · 🥉 ${fmtCoin(prizes[2])} jeton. ${kind==="day"?"Her gece 00:01'de":"Her ayın son gecesi 00:01'de"} hesaplara yüklenir.</div><div id="lbList"><div class="empty">Yükleniyor…</div></div>`);
  $("#eBody").onclick=e=>{const b=e.target.closest("[data-lb]");if(b)openRanking(b.dataset.lb)};
  if(lbUnsub)lbUnsub();
  lbUnsub=onSnapshot(query(collection(fs,...col.split("/")),orderBy("points","desc"),limit(100)),s=>{
    const rows=s.docs.map(d=>({uid:d.id,...d.data()})).filter(x=>(x.points||0)>0);
    rows.forEach(r=>watchUser(r.uid));
    const medal=i=>i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1;
    const el=$("#lbList");if(!el)return;
    el.innerHTML=rows.length?rows.map((r,i)=>`<div class="lbrow ${r.uid===me?"me":""}"><span class="rk">${medal(i)}</span>${avHTML(r.uid)}<span class="nm">${esc(r.uid===me?"Sen":realName(r.uid))}${vipMark(r.uid)}</span><span class="isub">${r.wins||0} galibiyet</span><span class="pt">${fmtCoin(r.points)} p</span></div>`).join(""):`<div class="empty">${kind==="day"?"Bugün":"Bu ay"} henüz kimse puan almadı. İlk sen ol!</div>`;
  },()=>{const el=$("#lbList");if(el)el.innerHTML='<div class="empty">Sıralama yüklenemedi</div>'});
}
$("#eClose").addEventListener("click",()=>{if(lbUnsub){lbUnsub();lbUnsub=null}});
function openAdmin(){
  const h=houseStats||{};
  openInfoModal("Yönetim paneli",`<div class="pk" style="display:block;margin-bottom:10px"><div class="isub">Kasa (net)</div><div style="font-size:20px;font-weight:800"><span class="coin"></span> ${fmtCoin(h.net||0)}</div><div class="isub">%5 kesinti: ${fmtCoin(h.rake||0)} · Bilgisayar kazancı: ${fmtCoin(h.botWin||0)} · Bilgisayar ücreti: −${fmtCoin(h.botStake||0)} · ${fmtCoin(h.hands||0)} el</div></div><div class="row2" style="margin-bottom:10px"><button id="adReps" style="background:#E53935">🚩 Şikâyetler</button></div><input id="adCode" inputmode="numeric" placeholder="Kullanıcının TR ID'si (örn. 482 913)"><div class="row2"><button id="adFind" style="background:var(--brand)">Bul</button></div><div id="adOut" style="margin-top:10px"></div>`);
  $("#adReps").onclick=adminReports;
  $("#adFind").onclick=adminLookup;$("#adCode").onkeydown=e=>{if(e.key==="Enter")adminLookup()};setTimeout(()=>$("#adCode").focus(),60);
}
const banLabel=u=>u>Date.now()+3650*86400e3?"kalıcı yasaklı":"askıda: "+new Date(u).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})+" tarihine kadar";
const banBtns=key=>`<div class="row2"><button data-ban="${key}:1" style="background:#F07A12">1 gün</button><button data-ban="${key}:7" style="background:#F07A12">7 gün</button><button data-ban="${key}:30" style="background:#D7261E">30 gün</button><button data-ban="${key}:0" style="background:#111">Kalıcı</button></div>`;
async function adminReports(){
  $("#adOut").innerHTML='<div class="isub">Yükleniyor…</div>';
  let r;try{r=await callApi("/api/admin",{action:"reports"})}catch(e){$("#adOut").innerHTML='<div class="isub">Yüklenemedi</div>';return}
  const list=r.reports||[];
  $("#adOut").innerHTML=`<div class="fl">Açık şikâyetler (${list.length})</div>`+(list.length?list.map(x=>`<div class="rep"><b>${esc(x.target.name)}</b> · TR ID ${fmtCode(x.target.code||"")}${x.count>1?` · <span style="color:#E53935">${x.count} şikâyet</span>`:""}${x.target.banned?` · <span style="color:#E53935">${banLabel(x.target.banned)}</span>`:""}
    <div class="isub">${esc(x.reason)} · ${esc(x.ctx)} · şikâyet eden ${esc(x.by.name)} · ${new Date(x.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</div>
    ${x.note?`<div style="margin-top:4px">“${esc(x.note)}”</div>`:""}${x.msgs.length?`<div class="rm">${x.msgs.map(esc).join("\n")}</div>`:""}
    <div class="isub" style="margin-top:6px">Askıya al / yasakla:</div>${banBtns("r"+x.id)}<div class="row2"><button data-dismiss="${esc(x.id)}" style="background:#777">Yoksay</button></div></div>`).join(""):'<div class="isub">Açık şikâyet yok 🎉</div>');
  $("#adOut").onclick=async e=>{
    const d=e.target.closest("[data-dismiss]"),b=e.target.closest("[data-ban]");
    if(d){d.disabled=true;try{await callApi("/api/admin",{action:"resolve",id:d.dataset.dismiss,verdict:"dismiss"});toast("Yoksayıldı");adminReports()}catch(err){toast("Yapılamadı");d.disabled=false}}
    if(b){const [k,days]=b.dataset.ban.split(":");const id=k.slice(1);
      if(!confirm(days==="0"?"Bu hesap kalıcı olarak yasaklansın mı?":`Bu hesap ${days} gün askıya alınsın mı?`))return;
      b.disabled=true;try{await callApi("/api/admin",{action:"resolve",id,verdict:"ban",days:+days});toast("Uygulandı");adminReports()}catch(err){toast("Yapılamadı");b.disabled=false}}
  };
}
async function adminLookup(){
  const code=$("#adCode").value.replace(/\D/g,"");if(code.length!==6){toast("6 haneli ID yaz");return}
  $("#adOut").innerHTML='<div class="isub">Aranıyor…</div>';
  let r;try{r=await callApi("/api/admin",{action:"lookup",code})}catch(e){$("#adOut").innerHTML=`<div class="isub">${e.status===404?"Bu ID ile kullanıcı yok":"Bulunamadı"}</div>`;return}
  const w=r.wallet;
  $("#adOut").innerHTML=`<div class="pk" style="display:block"><b>${esc(r.user.name||"İsimsiz")}</b> · TR ID ${fmtCode(r.user.code)}<div style="margin-top:6px;font-size:20px;font-weight:800"><span class="coin"></span> ${w?fmtCoin(w.balance):"Cüzdan yok"}</div>${w?`<div class="isub">Seviye ${w.level} · ${w.wins} galibiyet · ${w.games} oyun</div>`:""}</div>
    <div class="pk" style="display:block;margin-top:8px">${r.ban?`<b style="color:#E53935">${banLabel(r.ban.until)}</b><div class="isub">${esc(r.ban.reason)}</div><div class="row2" style="margin-top:6px"><button id="adUnban" style="background:#0E7C3A">Askıyı kaldır</button></div>`:`<div class="isub">Askıya al / yasakla</div>${banBtns("u")}`}</div>
    <input id="adAmt" inputmode="numeric" placeholder="Miktar (örn. 100000)"><input id="adWhy" maxlength="80" placeholder="Açıklama (isteğe bağlı)">
    <div class="row2"><button id="adAdd">+ Yükle</button><button id="adSub" class="neg">− Düş</button></div><div id="adConfirm" style="margin-top:8px"></div>
    <div class="fl" style="margin-top:12px">Son hareketler</div>${(r.history||[]).map(h=>`<div class="hist"><span>${esc(h.reason)}</span><span class="isub">${new Date(h.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><span class="d" style="color:${h.delta>0?"#0E7C3A":"#E53935"}">${h.delta>0?"+":""}${fmtCoin(h.delta)}</span></div>`).join("")||'<div class="isub">Hareket yok</div>'}`;
  const go=async sign=>{const a=Math.abs(parseInt($("#adAmt").value.replace(/\D/g,""),10));if(!a){toast("Miktar yaz");return}
    const why=$("#adWhy")?.value||"";
    $("#adConfirm").innerHTML=`<div class="pk" style="display:block;border-color:${sign>0?"#0E7C3A":"#E53935"}">${esc(r.user.name||"Kullanıcı")} (${fmtCode(r.user.code)}) hesabına <b>${sign>0?"+":"−"}${fmtCoin(a)}</b> jeton ${sign>0?"yüklensin":"düşülsün"} mi?<div class="row2" style="margin-top:8px"><button id="adNo" style="background:#777">Vazgeç</button><button id="adYes" class="${sign>0?"":"neg"}">Onayla</button></div></div>`;
    $("#adNo").onclick=()=>{$("#adConfirm").innerHTML=""};
    $("#adYes").onclick=async()=>{$("#adYes").disabled=true;try{const x=await callApi("/api/admin",{action:"adjust",code,amount:sign*a,reason:why});toast("Yeni bakiye: "+fmtCoin(x.balance));adminLookup()}catch(e){toast("İşlem yapılamadı");$("#adYes").disabled=false}}};
  $("#adAdd").onclick=()=>go(1);$("#adSub").onclick=()=>go(-1);
  if($("#adUnban"))$("#adUnban").onclick=async()=>{try{await callApi("/api/admin",{action:"unban",code});toast("Askı kaldırıldı");adminLookup()}catch(e){toast("Yapılamadı")}};
  $("#adOut").onclick=async e=>{const b=e.target.closest("[data-ban]");if(!b)return;const days=+b.dataset.ban.split(":")[1];
    if(!confirm(days?`${r.user.name||"Bu hesap"} ${days} gün askıya alınsın mı?`:`${r.user.name||"Bu hesap"} kalıcı olarak yasaklansın mı?`))return;
    b.disabled=true;try{await callApi("/api/admin",{action:"ban",code,days,reason:"Kurallara aykırı davranış"});toast("Uygulandı");adminLookup()}catch(err){toast("Yapılamadı");b.disabled=false}};
}
// Masa ücreti seçimi: salonlar bakiyeye göre açılır
function tierIdx(bal){const t=catalog?.tiers||[];let i=0;t.forEach((x,k)=>{if((bal||0)>=x.min)i=k});return i}
function pickStake(cb){
  const bal=wallet?.balance||0,ti=tierIdx(bal),tiers=catalog?.tiers||[{name:"Çaylak Salonu",icon:"🌱",min:0,stakes:[0]}];
  const rk=Math.round((catalog?.rake??0.05)*100);
  const html=tiers.map((t,k)=>{const open=k<=ti;return`<div class="fl" style="margin-top:10px">${t.icon} ${esc(t.name)} <span class="isub">${k<tiers.length-1?fmtCoin(t.min)+" – "+fmtCoin(tiers[k+1].min-1):fmtCoin(t.min)+" ve üzeri"}</span></div><div class="stk">${t.stakes.map(v=>`<button data-stake="${v}" ${!open||v>bal?"disabled":""}>${v?fmtCoin(v):"Ücretsiz"}<small>${!open?fmtCoin(t.min)+" jetonla açılır":v>bal?"Bakiye yetmez":v?"Pot ≈ "+fmtCoin(v*4):"Jetonsuz oyun"}</small></button>`).join("")}</div>`}).join("");
  openInfoModal("Masa ücreti",`<p class="isub">Oturan herkesten alınır, kazanan potu alır (%${rk} kesinti). Bilgisayar kazanırsa pot kasaya gider. Berabere biterse ücretler iade edilir.</p>${html}`);
  $("#eBody").onclick=e=>{const b=e.target.closest("[data-stake]");if(!b||b.disabled)return;const v=+b.dataset.stake;
    if(v&&!wallet?.adult){closeE();if(wallet?.ageSet)toast("Jetonlu masalar 18 yaş üstüne açık",3000);else askAge(()=>pickStake(cb));return}
    closeE();cb(v)};
}
/* ---------- oyunlar: Okey ---------- */
// Masa durumu games/{id}, kendi taşlarım games/{id}/hands/{me}. Bütün hamleler /api/game üzerinden sunucuda doğrulanır.
const T_COLORS=["kırmızı","sarı","mavi","siyah"];
const tIsFake=t=>t===104||t===105, tColor=t=>Math.floor(t/26), tNum=t=>Math.floor((t%26)/2)+1;
function tOkey(ind){const c=tColor(ind),n=tNum(ind);return{c,n:n===13?1:n+1}}
function tIsWild(t,ok){return !tIsFake(t)&&tColor(t)===ok.c&&tNum(t)===ok.n}
function tileHTML(t,ok,{sm=false,sel=false,cls=""}={}){
  if(t==null)return`<div class="tile empty ${sm?"sm":""}">boş</div>`;
  if(tIsFake(t))return`<div class="tile fake ${sm?"sm":""} ${sel?"sel":""} ${cls}" data-t="${t}" aria-label="sahte okey">★<span class="dot"></span></div>`;
  const w=ok&&tIsWild(t,ok);
  return`<div class="tile c${tColor(t)} ${w?"wild":""} ${sm?"sm":""} ${sel?"sel":""} ${cls}" data-t="${t}" aria-label="${T_COLORS[tColor(t)]} ${tNum(t)}${w?" okey":""}">${tNum(t)}<span class="dot"></span></div>`;
}
let game=null;            // {id, data, hand, order, sel, unsubs, busy}
async function gameApi(body,type){
  const t=type||(game&&game.data&&game.data.type);
  const r=await callApi(t==="pool"?"/api/pool":"/api/game",body).catch(e=>({error:e.status===409?"busy":"net"}));
  return r;
}
$("#gameBtn").onclick=()=>{if(!cur)return;closeAll();overlay.classList.add("show");$("#gpick").classList.add("show")};
$("#gpickClose").onclick=()=>{$("#gpick").classList.remove("show");overlay.classList.remove("show")};
$("#gpick").addEventListener("click",async e=>{
  const it=e.target.closest("[data-newgame]");if(!it||!cur)return;
  const conv=cur,type=it.dataset.newgame;$("#gpick").classList.remove("show");overlay.classList.remove("show");
  pickStake(async stake=>{
    toast("Masa kuruluyor…",2500);
    const r=await gameApi({action:"create",type,conv,stake},type);
    if(!r||!r.id){toast(r&&r.error==="balance"?"Bakiyen yetmiyor":r&&r.error==="stake"?"Bu masa için seviyen yetmiyor":"Masa kurulamadı, tekrar dene");return}
    await sendContent(conv,{t:"game",gid:r.id,kind:type,stake});
    openGame(r.id);
  });
});
$("#msgs").addEventListener("click",e=>{const c=e.target.closest("[data-game]");if(c)openGame(c.dataset.game)});

function seatName(s){if(!s)return"Boş";if(s.bot)return s.name||"Bot";return s.uid===me?"Sen":realName(s.uid)}
function seatAv(s){if(!s)return`<div class="av" style="background:rgba(255,255,255,.15)">+</div>`;if(s.bot)return`<div class="av" style="background:#455A64">🤖</div>`;return avHTML(s.uid)}
function openGame(id){
  closeGame(true);
  game={id,data:null,hand:[],order:[],sel:null,unsubs:[],busy:false,lastHand:new Set()};
  $("#gamescr").classList.add("show");$("#gTable").innerHTML='<div class="lobby">Masa yükleniyor…</div>';$("#gRack").innerHTML="";$("#gMsg").textContent="";
  try{history.pushState({game:id,chat:cur},"")}catch(e){}
  game.unsubs.push(onSnapshot(doc(fs,"games",id),s=>{
    if(!game||game.id!==id)return;
    if(!s.exists()){$("#gTable").innerHTML='<div class="lobby">Bu masaya erişimin yok ya da masa kapandı.</div>';return}
    game.data=s.data();(game.data.seats||[]).forEach(x=>x&&x.uid&&watchUser(x.uid));
    renderGame();
  },()=>{$("#gTable").innerHTML='<div class="lobby">Masa açılamadı.</div>'}));
  game.unsubs.push(onSnapshot(doc(fs,"games",id,"hands",me),s=>{
    if(!game||game.id!==id)return;
    const tiles=s.exists()&&Array.isArray(s.data().tiles)?s.data().tiles:[];
    const prevSet=new Set(game.hand);game.hand=tiles;
    // sıralamayı koru: kalanlar yerinde, yeniler sona
    const keep=game.order.filter(t=>tiles.includes(t));tiles.forEach(t=>{if(!keep.includes(t))keep.push(t)});
    game.order=keep;game.newTiles=new Set(tiles.filter(t=>!prevSet.has(t)&&prevSet.size));
    if(game.sel!=null&&!tiles.includes(game.sel))game.sel=null;
    renderGame();
  },()=>{}));
  game.poke=setInterval(()=>{const d=game&&game.data;if(!d||d.status!=="play")return;const s=d.seats[d.turn];if(s&&!s.bot&&s.uid!==me&&Date.now()-(d.lastMoveAt||0)>(d.type==="pool"?62000:47000))gameApi({action:"poke",id})},10000);
}
function closeGame(silent){
  if(!game)return;game.unsubs.forEach(u=>{try{u()}catch(e){}});clearInterval(game.poke);if(game.raf)cancelAnimationFrame(game.raf);game=null;$("#gamescr").classList.remove("pool");
  $("#gamescr").classList.remove("show");
}
$("#gBack").onclick=()=>{try{if(history.state&&history.state.game){history.back();return}}catch(e){}closeGame()};
window.addEventListener("popstate",()=>{if(game&&!(history.state&&history.state.game))closeGame()});
$("#gLeave").onclick=()=>{if(!game)return;const id=game.id;openModal({title:"Masadan kalk",text:game.data&&game.data.status==="play"?"Yerine bilgisayar oyuncu geçecek.":"Masadan kalkmak istiyor musun?",input:false,ok:"Kalk"},async()=>{await gameApi({action:"leave",id});closeGame()})};

function mySeatIdx(d){return(d.seats||[]).findIndex(s=>s&&!s.bot&&s.uid===me)}
function renderGame(){
  if(!game||!game.data)return;
  const d=game.data,my=mySeatIdx(d);
  const gs=$("#gamescr");gs.className="gamescr show felt-"+mySkin("table")+" rack-"+mySkin("rack");
  if(d.type==="pool"){gs.classList.add("pool");return renderPool(d,my)}
  $("#gTitleTxt").textContent="Okey";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. el`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  const ok=tOkey(d.indicator);
  const me4=my>=0?my:0;
  const pos=i=>["bottom","right","top","left"][(i-me4+4)%4];
  const isMyTurn=d.status==="play"&&d.turn===my;
  const canDraw=isMyTurn&&d.phase==="draw",canDiscard=isMyTurn&&d.phase==="discard";
  const leftSeat=(me4+3)%4;
  let html="";
  d.seats.forEach((s,i)=>{const p=pos(i);if(p==="bottom")return;
    html+=`<div class="seat p-${p} ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(s)}<div class="nm">${esc(seatName(s))}${s&&!s.bot?vipMark(s.uid):""}</div><div class="ct">${(d.handCounts||[])[i]??""} taş · ${(d.scores||[])[i]||0} puan</div></div>`});
  // atılan taşlar: her oyuncunun son attığı
  const dpos={left:"d-lo",right:"d-ro",top:"d-top"};
  d.seats.forEach((s,i)=>{const p=pos(i);const arr=(d.discards||{})[i]||[];const top=arr.length?arr[arr.length-1]:null;
    if(p==="bottom")html+=`<div class="disc d-right"><div>${tileHTML(top,ok,{sm:true})}</div><div>Senin attığın</div></div>`;
    else if(i===leftSeat)html+=`<div class="disc d-left ${canDraw&&top!=null?"take":""}" id="gLeftDisc"><div>${tileHTML(top,ok,{sm:true})}</div><div>${canDraw&&top!=null?"Al":"Soldan gelen"}</div></div>`;
    else html+=`<div class="disc ${dpos[p]}">${tileHTML(top,ok,{sm:true})}</div>`;
  });
  html+=`<div class="center"><div><div class="pile ${canDraw?"take":""}" id="gPile">${d.pileCount}</div><div class="lbl">${canDraw?"Çek":"Deste"}</div></div><div><div>${tileHTML(d.indicator,null,{sm:true})}</div><div class="lbl">Gösterge</div></div><div><div>${tileHTML(ok.c*26+(ok.n-1)*2,ok,{sm:true})}</div><div class="lbl">Okey</div></div></div>`;
  if(d.status==="over"){
    const w=d.winner;
    html+=`<div class="overbox"><b style="font-size:18px">${w==null?"El berabere bitti":(w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı")}</b><div style="font-size:13px;opacity:.85">${esc(d.log||"")}${d.points?" · +"+d.points+" puan":""}</div>${d.payout?(d.payout.refund?`<div>Berabere: masa ücretleri iade edildi</div>`:d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}</div>`):""}${d.winHand?`<div class="wh">${[...d.winHand].sort((a,b)=>(tIsWild(a,ok)-tIsWild(b,ok))||(tIsFake(a)?ok.c*100+ok.n:tColor(a)*100+tNum(a))-(tIsFake(b)?ok.c*100+ok.n:tColor(b)*100+tNum(b))).map(t=>tileHTML(t,ok,{sm:true})).join("")}</div>`:""}<div class="sc">${d.seats.map((s,i)=>`<span>${esc(seatName(s))}: <b>${(d.scores||[])[i]||0}</b></span>`).join("")}</div>${d.host===me?`<button id="gAgain">Yeni el</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni eli masa sahibi başlatır</div>`}</div>`;
  }
  $("#gTable").innerHTML=html;
  // mesaj
  let msg="";
  if(d.status==="play"){
    if(my<0)msg="İzliyorsun";
    else if(canDraw)msg="Sıra sende: desteden çek ya da soldan gelen taşı al";
    else if(canDiscard)msg=game.sel!=null?"“At” ile at, el bitiyorsa “Bitir”":"Atmak istediğin taşa dokun";
    else msg=`${esc(seatName(d.seats[d.turn]))} oynuyor…`;
  }
  $("#gMsg").innerHTML=msg;
  // ıstaka
  const tiles=game.order.filter(t=>game.hand.includes(t));
  let rack=tiles.map(t=>tileHTML(t,ok,{sel:game.sel===t,cls:game.newTiles&&game.newTiles.has(t)?"new":""})).join("");
  for(let i=tiles.length;i<16;i++)rack+=`<div></div>`;
  $("#gRack").innerHTML=my>=0?rack:"";
  $("#gRack").style.display=my>=0?"":"none";$("#gActions").style.display=my>=0&&d.status==="play"?"":"none";$("#pCtrl").style.display="none";
  $("#gDiscard").disabled=!(canDiscard&&game.sel!=null)||game.busy;
  $("#gFinish").disabled=!(canDiscard&&game.sel!=null)||game.busy;
  const pile=$("#gPile");if(pile)pile.onclick=()=>canDraw&&gameMove({action:"draw",from:"pile"});
  const ld=$("#gLeftDisc");if(ld)ld.onclick=()=>canDraw&&gameMove({action:"draw",from:"left"});
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
function renderLobby(d,my){
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#gMsg").textContent="";$("#pCtrl").style.display="none";game.pbuilt=false;
  if(d.status==="closed"){$("#gTable").innerHTML='<div class="lobby">Masa kapandı.</div>';return}
  const seats=d.seats.map(s=>`<div class="st">${seatAv(s)}<span>${esc(s?seatName(s):"Boş · bilgisayar oturur")}</span></div>`).join("");
  const host=d.host===me,free=d.seats.some(s=>!s),pool=d.type==="pool";
  $("#gTable").innerHTML=`<div class="lobby"><div style="font-size:40px">${pool?"🎱":"🀄"}</div><b style="font-size:20px">${pool?"Bilardo masası · 8 top":"Okey masası"}</b><div style="opacity:.9;text-align:center">${d.stake?`Masa ücreti <span class="coin"></span> ${fmtCoin(d.stake)}<br><span style="font-size:12.5px">Kazanan potu alır (%5 kesinti). Bilgisayar kazanırsa pot kasaya gider.</span>`:"Ücretsiz masa"}</div><div class="seats">${seats}</div>${my<0?(free?'<button id="gJoin">Masaya otur</button>':'<div>Masa dolu</div>'):host?'<button id="gStart">Oyunu başlat</button><div style="font-size:12.5px;opacity:.8">Boş yerlere bilgisayar oturur</div>':'<div style="opacity:.85">Masa sahibinin başlatması bekleniyor…</div>'}</div>`;
  const j=$("#gJoin");if(j)j.onclick=()=>{if(d.stake&&!wallet?.adult){if(wallet?.ageSet)toast("Jetonlu masalar 18 yaş üstüne açık",3000);else askAge(()=>gameMove({action:"join"}));return}gameMove({action:"join"})};
  const st=$("#gStart");if(st)st.onclick=()=>gameMove({action:"start"});
}
async function gameMove(body){
  if(!game||game.busy)return;const id=game.id;game.busy=true;renderGame();
  const r=await gameApi({...body,id});
  if(game&&game.id===id){game.busy=false;
    if(r&&r.error==="nowin")toast("El bitmiyor. Taşlar seri ya da çift oluşturmalı.",3000);
    else if(r&&r.error==="balance")toast(r.who&&r.who.includes(me)?"Bakiyen masa ücretine yetmiyor":"Masadaki birinin bakiyesi yetmiyor",3500);
    else if(r&&r.error&&r.error!=="busy")toast("Hamle yapılamadı ("+r.error+")");
    if(body.action==="discard"||body.action==="finish")game.sel=null;
    renderGame();}
}
$("#gRack").addEventListener("click",e=>{
  const el=e.target.closest(".tile");if(!el||!game)return;const t=+el.dataset.t;
  if(game.sel==null){game.sel=t}
  else if(game.sel===t){game.sel=null}
  else{const a=game.order.indexOf(game.sel),b=game.order.indexOf(t);if(a>=0&&b>=0){[game.order[a],game.order[b]]=[game.order[b],game.order[a]]}game.sel=null}
  game.newTiles=null;renderGame();
});
/* ---------- oyunlar: Bilardo (8 top) ---------- */
// Vuruş sunucuda simüle edilir. İstemci aynı fizik koduyla vuruşları tekrar oynatır (animasyon), sonra sunucunun sonucuna oturur.
const BALL_COL=["#fff","#F2C200","#1E4FD8","#D7261E","#5B2A86","#F07A12","#127A3A","#7A1B1B","#111"];
const FELT_COL={yesil:"#0f6b3a",lacivert:"#1d3d7a",bordo:"#7a1a28",siyah:"#2e2e2e",ay:"#b30f27",vip_mor:"#4d1c70",vip_mermer:"#5d7a8c",vip_altin:"#1b4a32"};
const RAIL_COL={ceviz:"#6b4423",abanoz:"#2a1c14",kiraz:"#7a2a22",altin:"#c79a2a",vip_sedef:"#d9cfc2",vip_elmas:"#7fb8dc"};
const GROUP_TR={solid:"düz",stripe:"çizgili"};
function renderPool(d,my){
  $("#gTitleTxt").textContent="Bilardo";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. oyun`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  $("#gRack").style.display="none";$("#gActions").style.display="none";
  if(!game.pbuilt){
    $("#gTable").innerHTML='<div class="pwrap"><div class="pbar" id="pBar"></div><div class="pcv"><canvas id="pc"></canvas></div><div id="pOver"></div></div>';
    game.pbuilt=true;game.pseq=null;game.pview=null;game.aim=null;game.place=null;
    poolInput();
  }
  const g=d.groups;
  const left=k=>(game.pview||d.balls||[]).filter(b=>P.typeOf(b.i)===k).length;
  $("#pBar").innerHTML=d.seats.map((s,i)=>`<div class="pp ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(s)}<div><b>${esc(seatName(s))}${s&&!s.bot?vipMark(s.uid):""}</b><span>${g?GROUP_TR[g[i]]+" · "+left(g[i])+" top kaldı":"Grup belli değil"} · ${(d.scores||[])[i]||0} galibiyet</span></div></div>`).join('<div class="vs">vs</div>');
  // yeni vuruş(lar) geldiyse oynat
  if(game.pseq!==d.seq){
    const first=game.pseq==null;game.pseq=d.seq;
    if(!first&&(d.lastShots||[]).length)playShots(d.lastShots.slice(),()=>{game.pview=null;afterShots()});
    else{game.pview=null;afterShots()}
  }else if(!game.anim)afterShots();
  function afterShots(){
    if(!game||!game.data)return;
    const d=game.data;
    const myTurn=d.status==="play"&&d.turn===mySeatIdx(d);
    if(myTurn&&(d.ballInHand||!d.balls.some(b=>b.i===0))){
      const c=d.balls.find(b=>b.i===0);const others=d.balls.filter(b=>b.i!==0);
      if(!game.place||!P.canPlace(others,game.place.x,game.place.y,d.ballInHand==="kitchen"))
        game.place=c&&P.canPlace(others,c.x,c.y,d.ballInHand==="kitchen")?{x:c.x,y:c.y}:findSpot(others,d.ballInHand==="kitchen");
    }else game.place=null;
    if(myTurn&&!game.aim){const c=curCue();const t=d.balls.find(b=>b.i!==0);game.aim=c&&t?{x:t.x-c.x,y:t.y-c.y}:{x:1,y:0}}
    $("#pCtrl").style.display=myTurn?"":"none";
    $("#pShoot").disabled=!myTurn||game.busy;
    let msg="";
    if(d.status==="play"){
      if(my<0)msg="İzliyorsun";
      else if(myTurn)msg=game.place?"Beyaz topu sürükleyip yerleştir, sonra nişan al":"Sıra sende: masaya dokunup nişan al, gücü seç, Vur";
      else msg=`${esc(seatName(d.seats[d.turn]))} oynuyor…`;
      if(d.log)msg=`<span style="opacity:.8;font-weight:500">${esc(d.log)}</span><br>`+msg;
    }
    $("#gMsg").innerHTML=msg;
    const ov=$("#pOver");
    if(d.status==="over"){
      const w=d.winner;
      ov.innerHTML=`<div class="overbox"><b style="font-size:18px">${w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}</b><div style="font-size:13px;opacity:.85">${esc(d.log||"")}</div>${d.payout?(d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}</div>`):""}<div class="sc">${d.seats.map((s,i)=>`<span>${esc(seatName(s))}: <b>${(d.scores||[])[i]||0}</b></span>`).join("")}</div>${d.host===me?`<button id="gAgain">Yeni oyun</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni oyunu masa sahibi başlatır</div>`}</div>`;
      const ag=$("#gAgain");if(ag)ag.onclick=()=>{game.aim=null;gameMove({action:"again"})};
      $("#pCtrl").style.display="none";
    }else ov.innerHTML="";
    drawPool();
  }
}
function findSpot(others,kitchen){for(const [x,y] of [[200,250],[150,250],[200,150],[200,350],[100,250],[500,250]])if(P.canPlace(others,x,y,kitchen))return{x,y};return{x:120,y:250}}
function curCue(){const d=game.data;if(game.place)return game.place;return(game.pview||d.balls||[]).find(b=>b.i===0)||null}
function poolBalls(){const d=game.data;let bs=(game.pview||d.balls||[]);if(game.place&&!game.pview)bs=bs.filter(b=>b.i!==0).concat([{i:0,...game.place}]);return bs}
function playShots(list,done){
  game.anim=true;$("#pCtrl").style.display="none";
  const next=()=>{
    if(!game)return;const sh=list.shift();
    if(!sh){game.anim=false;done();return}
    const frames=[];P.simulate(sh.before,{x:sh.dx,y:sh.dy},sh.power,bs=>frames.push(bs));
    let k=0;const d=game.data;
    $("#gMsg").innerHTML=`${esc(seatName(d.seats[sh.seat]))} vurdu…`;
    const tick=()=>{if(!game)return;game.pview=frames[Math.min(k,frames.length-1)];drawPool();k+=2;
      if(k<frames.length+2)game.raf=requestAnimationFrame(tick);
      else{if(sh.foul)$("#gMsg").innerHTML=`Faul: ${esc(sh.reason)}`;setTimeout(next,list.length?450:150)}};
    game.pview=sh.before;drawPool();setTimeout(()=>{game.raf=requestAnimationFrame(tick)},250);
  };
  next();
}
function poolLayout(){
  const cv=$("#pc");if(!cv)return null;const box=cv.parentElement;const cw=box.clientWidth,ch=box.clientHeight;const dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){cv.width=Math.round(cw*dpr);cv.height=Math.round(ch*dpr);cv.style.width=cw+"px";cv.style.height=ch+"px"}
  const M=42,TW=P.W+2*M,TH=P.H+2*M,rot=ch>cw;
  const s=rot?Math.min(cw/TH,ch/TW):Math.min(cw/TW,ch/TH);
  const ox=rot?(cw-TH*s)/2+M*s:(cw-TW*s)/2+M*s,oy=rot?(ch-TW*s)/2+M*s:(ch-TH*s)/2+M*s;
  return{cv,dpr,s,ox,oy,rot,M,
    m:rot?[0,s*dpr,-s*dpr,0,(ox+P.H*s)*dpr,oy*dpr]:[s*dpr,0,0,s*dpr,ox*dpr,oy*dpr],
    toT:(sx,sy)=>rot?{x:(sy-oy)/s,y:P.H-(sx-ox)/s}:{x:(sx-ox)/s,y:(sy-oy)/s}};
}
function drawPool(){
  if(!game||!game.data)return;const L=poolLayout();if(!L)return;const {cv,M}=L;const c=cv.getContext("2d");
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);c.setTransform(...L.m);
  const felt=FELT_COL[mySkin("table")]||FELT_COL.yesil,rail=RAIL_COL[mySkin("rack")]||RAIL_COL.ceviz;
  c.fillStyle=rail;roundRect(c,-M,-M,P.W+2*M,P.H+2*M,26);c.fill();
  c.fillStyle="rgba(0,0,0,.25)";c.fillRect(-6,-6,P.W+12,P.H+12);
  c.fillStyle=felt;c.fillRect(0,0,P.W,P.H);
  const gr=c.createRadialGradient(P.W/2,P.H/2,40,P.W/2,P.H/2,P.W*0.6);gr.addColorStop(0,"rgba(255,255,255,.10)");gr.addColorStop(1,"rgba(0,0,0,.22)");c.fillStyle=gr;c.fillRect(0,0,P.W,P.H);
  if(mySkin("table")==="vip_altin"){c.strokeStyle="#c9a43a";c.lineWidth=4;c.strokeRect(6,6,P.W-12,P.H-12)}
  c.strokeStyle="rgba(255,255,255,.18)";c.lineWidth=2;c.beginPath();c.moveTo(P.HEAD_X,0);c.lineTo(P.HEAD_X,P.H);c.stroke();
  c.fillStyle="rgba(255,255,255,.35)";[[250,P.H/2],[750,P.H/2]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,3,0,7);c.fill()});
  for(const [x,y,r] of P.POCKETS){c.fillStyle="#0a0a0a";c.beginPath();c.arc(x,y,r*0.85,0,7);c.fill()}
  // elmas işaretler
  c.fillStyle="rgba(255,255,255,.7)";for(let k=1;k<8;k++){if(k===4)continue;[[k*P.W/8,-M/2],[k*P.W/8,P.H+M/2]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,3.5,0,7);c.fill()})}
  for(let k=1;k<4;k++)[[-M/2,k*P.H/4],[P.W+M/2,k*P.H/4]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,3.5,0,7);c.fill()});
  const d=game.data,bs=poolBalls(),my=mySeatIdx(d);
  const myTurn=d.status==="play"&&d.turn===my&&!game.anim&&!game.busy;
  // nişan çizgisi
  const cue=bs.find(b=>b.i===0);
  if(myTurn&&cue&&game.aim){
    const dl=Math.hypot(game.aim.x,game.aim.y)||1,ux=game.aim.x/dl,uy=game.aim.y/dl;
    let tBest=Infinity,hit=null;
    for(const b of bs){if(b.i===0)continue;const fx=cue.x-b.x,fy=cue.y-b.y;const bq=fx*ux+fy*uy,cq=fx*fx+fy*fy-4*P.R*P.R;const disc=bq*bq-cq;if(disc<0)continue;const t=-bq-Math.sqrt(disc);if(t>0&&t<tBest){tBest=t;hit=b}}
    const tw=Math.min(ux>0?(P.W-P.R-cue.x)/ux:ux<0?(P.R-cue.x)/ux:Infinity,uy>0?(P.H-P.R-cue.y)/uy:uy<0?(P.R-cue.y)/uy:Infinity);
    const t=Math.min(tBest,tw),gx=cue.x+ux*t,gy=cue.y+uy*t;
    c.setLineDash([10,8]);c.strokeStyle="rgba(255,255,255,.85)";c.lineWidth=2.5;c.beginPath();c.moveTo(cue.x,cue.y);c.lineTo(gx,gy);c.stroke();c.setLineDash([]);
    c.strokeStyle="rgba(255,255,255,.9)";c.lineWidth=2;c.beginPath();c.arc(gx,gy,P.R,0,7);c.stroke();
    if(hit&&tBest<=tw){const nx=hit.x-gx,ny=hit.y-gy,nl=Math.hypot(nx,ny)||1;c.strokeStyle="rgba(255,235,120,.9)";c.lineWidth=3;c.beginPath();c.moveTo(hit.x,hit.y);c.lineTo(hit.x+nx/nl*90,hit.y+ny/nl*90);c.stroke()}
    // ıstaka
    const pw=(+$("#pPow").value||60)/100,back=P.R+8+pw*60;
    c.strokeStyle="#d9b77c";c.lineWidth=7;c.lineCap="round";c.beginPath();c.moveTo(cue.x-ux*back,cue.y-uy*back);c.lineTo(cue.x-ux*(back+330),cue.y-uy*(back+330));c.stroke();
    c.strokeStyle="#333";c.lineWidth=7;c.beginPath();c.moveTo(cue.x-ux*(back+250),cue.y-uy*(back+250));c.lineTo(cue.x-ux*(back+330),cue.y-uy*(back+330));c.stroke();c.lineCap="butt";
  }
  if(game.place&&!game.pview&&myTurn){c.strokeStyle="rgba(255,255,255,.6)";c.setLineDash([4,4]);c.lineWidth=2;c.beginPath();c.arc(game.place.x,game.place.y,P.R+7,0,7);c.stroke();c.setLineDash([])}
  for(const b of bs)drawBall(c,b,L.rot);
}
function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function drawBall(c,b,rot){
  const R=P.R,col=BALL_COL[b.i>8?b.i-8:b.i];
  c.save();c.translate(b.x,b.y);if(rot)c.rotate(-Math.PI/2);
  c.fillStyle="rgba(0,0,0,.3)";c.beginPath();c.arc(1.8,2.2,R,0,7);c.fill();
  c.beginPath();c.arc(0,0,R,0,7);c.fillStyle=b.i>8?"#fff":col;c.fill();
  if(b.i>8){c.save();c.beginPath();c.arc(0,0,R,0,7);c.clip();c.fillStyle=col;c.fillRect(-R,-R*0.55,2*R,R*1.1);c.restore()}
  if(b.i>0){c.fillStyle="#fff";c.beginPath();c.arc(0,0,R*0.5,0,7);c.fill();c.fillStyle="#111";c.font=`bold ${b.i>9?8:9}px sans-serif`;c.textAlign="center";c.textBaseline="middle";c.fillText(String(b.i),0,0.5)}
  const hl=c.createRadialGradient(-R*0.35,-R*0.4,1,0,0,R);hl.addColorStop(0,"rgba(255,255,255,.55)");hl.addColorStop(0.35,"rgba(255,255,255,0)");hl.addColorStop(1,"rgba(0,0,0,.25)");
  c.fillStyle=hl;c.beginPath();c.arc(0,0,R,0,7);c.fill();
  c.restore();
}
function poolInput(){
  const cv=$("#pc");let drag=null;
  const pt=e=>{const r=cv.getBoundingClientRect();const L=poolLayout();return L.toT(e.clientX-r.left,e.clientY-r.top)};
  const myTurn=()=>{const d=game&&game.data;return d&&d.status==="play"&&d.turn===mySeatIdx(d)&&!game.anim&&!game.busy};
  cv.addEventListener("pointerdown",e=>{if(!myTurn())return;const p=pt(e);e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(_){}
    if(game.place&&Math.hypot(p.x-game.place.x,p.y-game.place.y)<P.R*3){drag="cue";return}
    drag="aim";aimAt(p)});
  cv.addEventListener("pointermove",e=>{if(!drag||!myTurn())return;const p=pt(e);
    if(drag==="cue"){const d=game.data,others=d.balls.filter(b=>b.i!==0),k=d.ballInHand==="kitchen";
      const x=Math.max(P.R,Math.min(k?P.HEAD_X:P.W-P.R,p.x)),y=Math.max(P.R,Math.min(P.H-P.R,p.y));
      if(P.canPlace(others,x,y,k)){game.place={x,y};drawPool()}}
    else aimAt(p)});
  const up=()=>{drag=null};cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
  function aimAt(p){const c=curCue();if(!c)return;const ax=p.x-c.x,ay=p.y-c.y;if(Math.hypot(ax,ay)<4)return;game.aim={x:ax,y:ay};drawPool()}
}
$("#pPow").addEventListener("input",()=>{$("#pPowV").textContent=$("#pPow").value+"%";drawPool()});
$("#pShoot").onclick=async()=>{
  if(!game||!game.data||!game.aim||game.anim)return;
  const body={action:"shoot",dx:game.aim.x,dy:game.aim.y,power:(+$("#pPow").value||60)/100};
  if(game.place){body.cx=game.place.x;body.cy=game.place.y}
  game.aim=null;await gameMove(body);
};
window.addEventListener("resize",()=>{if(game&&game.data&&game.data.type==="pool")drawPool()});
$("#gDiscard").onclick=()=>{if(game&&game.sel!=null)gameMove({action:"discard",tile:game.sel})};
$("#gFinish").onclick=()=>{if(game&&game.sel!=null)gameMove({action:"finish",tile:game.sel})};
function sortRack(mode){
  if(!game||!game.data||!game.data.indicator)return;const ok=tOkey(game.data.indicator);
  const key=t=>tIsWild(t,ok)?[9,99]:tIsFake(t)?[ok.c,ok.n]:[tColor(t),tNum(t)];
  let arr=[...game.hand];
  if(mode==="run")arr.sort((a,b)=>{const x=key(a),y=key(b);return x[0]-y[0]||x[1]-y[1]});
  else{const k=t=>{const v=key(t);return v[0]*100+v[1]};const cnt={};arr.forEach(t=>cnt[k(t)]=(cnt[k(t)]||0)+1);arr.sort((a,b)=>(cnt[k(b)]-cnt[k(a)])||k(a)-k(b))}
  game.order=arr;game.sel=null;game.newTiles=null;renderGame();
}
$("#gSortRun").onclick=()=>sortRack("run");
$("#gSortPair").onclick=()=>sortRack("pair");

/* ---------- sunucu çağrıları ---------- */
async function callApi(path,body){
  const u=auth.currentUser;if(!u)throw new Error("auth");
  const t=await u.getIdToken();
  const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+t},body:JSON.stringify(body)});
  if(!r.ok)throw Object.assign(new Error("api"),{status:r.status});
  return r.json();
}

/* ---------- bildirimler ---------- */
let messaging=null;
const notifSupported=()=>"Notification" in window&&"serviceWorker" in navigator&&"PushManager" in window;
async function setupPush(ask){
  if(!me||!notifSupported())return false;
  if(!(await messagingSupported().catch(()=>false)))return false;
  if(Notification.permission==="denied")return false;
  if(Notification.permission!=="granted"){
    if(!ask){showNotifBar();return false}
    const p=await Notification.requestPermission();
    if(p!=="granted"){hideNotifBar(true);return false}
  }
  hideNotifBar(false);
  messaging=messaging||getMessaging(app);
  const reg=await navigator.serviceWorker.register("/sw.js");await navigator.serviceWorker.ready;
  const token=await getToken(messaging,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
  if(!token)return false;
  const ref=doc(fs,"private",me,"data","push");
  let tokens=[];try{const s=await getDoc(ref);if(s.exists()&&Array.isArray(s.data().tokens))tokens=s.data().tokens}catch(e){}
  if(!tokens.includes(token)){tokens=[...tokens.filter(t=>t!==token),token].slice(-10);await setDoc(ref,{tokens},{merge:true})}
  return true;
}
function showNotifBar(){let d=false;try{d=localStorage.getItem("tr-notif-x")==="1"}catch(e){}if(!d)$("#notifbar").classList.add("show")}
function hideNotifBar(remember){$("#notifbar").classList.remove("show");if(remember)try{localStorage.setItem("tr-notif-x","1")}catch(e){}}
$("#notifOn").onclick=async()=>{try{const ok=await setupPush(true);toast(ok?"Bildirimler açıldı 🔔":"Bildirimler açılamadı")}catch(e){toast("Bildirimler açılamadı")}};
$("#notifX").onclick=()=>hideNotifBar(true);
function notifMenu(){
  if(!notifSupported()){openModal({title:"Bildirimler",text:"Bu cihaz ya da tarayıcı bildirimleri desteklemiyor.",input:false,cancel:false});return}
  const p=Notification.permission;
  if(p==="granted"){setupPush(false).then(ok=>toast(ok?"Bildirimler açık ✓":"Bildirim kaydı yapılamadı"));return}
  if(p==="denied"){openModal({title:"Bildirimler kapalı",text:"Bildirim izni daha önce reddedilmiş. Telefonda <b>Ayarlar → Uygulamalar → TR Mesaj → Bildirimler</b>'den açabilirsin. Bilgisayarda adres çubuğundaki kilit simgesinden izin verebilirsin.",input:false,cancel:false});return}
  setupPush(true).then(ok=>toast(ok?"Bildirimler açıldı 🔔":"Bildirim izni verilmedi")).catch(()=>toast("Bildirimler açılamadı"));
}
if("serviceWorker" in navigator)navigator.serviceWorker.addEventListener("message",e=>{if(e.data&&e.data.type==="open"){try{const c=new URL(e.data.url,location.origin).searchParams.get("c");if(c){deepLink=c;openPendingDeepLink()}const k=new URL(e.data.url,location.origin).searchParams.get("call");if(k&&callLog[k])onIncoming(k,callLog[k])}catch(_){}}});
let deepLink=null,pendingCallId=null;
try{pendingCallId=new URLSearchParams(location.search).get("call");deepLink=new URLSearchParams(location.search).get("c");if(deepLink||location.search)history.replaceState(null,"","/")}catch(e){}
function openPendingDeepLink(){
  if(!deepLink||!ready)return;
  const c=deepLink;
  if(isGroupConv(c)&&!groups[gidOf(c)])return;
  deepLink=null;openChat(c);
}

/* ---------- telefon eşleştirme ---------- */
const phoneDocId=p=>p.replace("+","p");
async function syncPhone(old){
  if(!me||!myPhone)return;
  const k="tr-phone-"+me;let done=null;try{done=localStorage.getItem(k)}catch(e){}
  if(old&&old!==myPhone){try{await deleteDoc(doc(fs,"phones",phoneDocId(old)))}catch(e){}}
  if(done===myPhone&&!old)return;
  try{await setDoc(doc(fs,"phones",phoneDocId(myPhone)),{uid:me})}catch(e){/* zaten kayıtlı ya da başkası almış */}
  try{localStorage.setItem(k,myPhone)}catch(e){}
}
let cResults=[];
function closeContacts(){$("#cmodal").classList.remove("show");overlay.classList.remove("show")}
$("#cCancel").onclick=closeContacts;
$("#cAdd").onclick=async()=>{
  const sel=[...document.querySelectorAll("#cList input:checked")].map(i=>i.value);
  closeContacts();
  for(const u of sel){watchUser(u);await saveContact(u);if(!isFriend(u))await sendRequest(u)}
  if(sel.length)toast(sel.length+" kişiye arkadaşlık isteği gönderildi",3000);
};
async function findContacts(){
  const supported="contacts" in navigator&&"select" in navigator.contacts;
  if(!supported){openModal({title:"Rehberden bul",text:"Rehber seçimi sadece Android telefonlarda çalışıyor. Bilgisayarda kişileri TR ID ile ekleyebilirsin.",input:false,ok:"ID ile ekle",cancelText:"Kapat"},askAdd);return}
  let picked;
  try{picked=await navigator.contacts.select(["name","tel"],{multiple:true})}catch(e){toast("Rehber açılamadı");return}
  if(!picked||!picked.length)return;
  const phones=[],names=[];
  picked.forEach(c=>(c.tel||[]).forEach(t=>{phones.push(t);names.push((c.name&&c.name[0])||t)}));
  if(!phones.length){toast("Seçilen kişilerde telefon numarası yok");return}
  toast("Aranıyor…",3000);
  let res;
  try{res=await callApi("/api/contacts",{phones})}catch(e){toast(e.status===429?"Çok sık denedin, biraz sonra tekrar dene":"Arama yapılamadı");return}
  const byUid={};(res.matches||[]).forEach(m=>{if(!byUid[m.uid])byUid[m.uid]=names[m.i]});
  cResults=Object.keys(byUid);
  for(const u of cResults){watchUser(u);if(!users[u]){try{const s=await getDoc(doc(fs,"users",u));if(s.exists())users[u]=cleanUser(s.data())}catch(e){}}}
  closeAll();
  $("#cInfo").textContent=cResults.length?`${picked.length} kişiden ${cResults.length} tanesi TR kullanıyor.`:`Seçtiğin ${picked.length} kişiden hiçbiri henüz TR kullanmıyor.`;
  $("#cList").innerHTML=cResults.map(u=>`<label class="gitem">${avHTML(u)}<div class="gn"><b>${esc(byUid[u])}</b><span>TR'de: ${esc(realName(u))}${contacts.includes(u)?" · zaten ekli":""}</span></div><input type="checkbox" value="${esc(u)}"${contacts.includes(u)?"":" checked"}></label>`).join("");
  $("#cAdd").style.display=cResults.length?"":"none";
  overlay.classList.add("show");$("#cmodal").classList.add("show");
}

/* ---------- başlık bildirimi ---------- */
let firstSnap=true;
function notifyNew(s){
  if(firstSnap){firstSnap=false;return}
  const n=s.docChanges().filter(c=>c.type==="added"&&c.doc.data().from!==me&&!c.doc.metadata.hasPendingWrites).length;
  if(n&&document.hidden){document.title=`(${n}) TR`}
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)document.title="TR"});

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))}
