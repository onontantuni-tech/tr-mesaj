import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, collection, query, where, onSnapshot } from "firebase/firestore";

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
function previewText(c){if(!c)return"🔒 Mesaj";if(c.t==="img")return"📷 Fotoğraf";if(c.t==="voice")return"🎤 Sesli mesaj"+(c.dur?" ("+fmtDur(c.dur)+")":"");if(c.t==="sys")return c.text;return c.text||""}
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
  const html=list.map(e=>{
    const l=e.last,g=isGroupConv(e.c);let prev;
    if(l){const who=l.from===me?tick(l)+" ":(g?esc(realName(l.from).split(" ")[0])+": ":"");prev=`<span class="prev">${who}${esc(previewText(contentOf(l)))}</span>`}
    else prev=`<span class="prev">${g?"Grup oluşturuldu":"Mesaj göndermek için dokun"}</span>`;
    return`<div class="row" data-open="${esc(e.c)}"${e.c===cur?' style="background:var(--bg)"':''}>${avHTML(e.c)}
      <div class="meta"><div class="l1"><span class="name">${esc(e.title)}</span><span class="time ${e.unread?"unread":""}">${e.at?when(e.at):""}</span></div>
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
  $("#cName").textContent=convTitle(cur);
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
  const canSend=!g||!!grp;
  $("#composer").style.display=canSend?"":"none";
}
function renderAll(){renderChats();renderStatus();if(cur){renderChatHeader();renderMsgs()}}

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
}

/* ---------- gruplar ---------- */
function peopleList(){return[...new Set([...contacts,...raw.filter(m=>!m.gid).map(convOfMsg)])].filter(u=>u&&u!==me)}
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
  $("#gList").innerHTML=candidates.length?candidates.map(u=>memberRow(u,{check:true})).join(""):`<div class="empty" style="padding:20px">${mode==="create"?"Önce ID ile birkaç kişi ekle, sonra grup kurabilirsin.":"Eklenecek başka kişin yok."}</div>`;
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
    $("#iActs").innerHTML=(admin?`<button id="iAdd">Üye ekle</button><button id="iRename">Adını değiştir</button>`:"")+`<button class="danger" id="iLeave">Gruptan çık</button><button class="pri" id="iClose">Kapat</button>`;
    if(admin){$("#iAdd").onclick=()=>{closeInfo();openGroupModal("add",gid)};
      $("#iRename").onclick=()=>{closeInfo();openModal({title:"Grup adı",value:g.name,ok:"Kaydet"},async v=>{try{await setDoc(doc(fs,"groups",gid),{...g,name:v.slice(0,50)})}catch(e){toast("Değiştirilemedi")}})};}
    $("#iLeave").onclick=()=>{closeInfo();openModal({title:"Gruptan çık",text:`“${esc(g.name)}” grubundan çıkmak istiyor musun?`,input:false,ok:"Çık"},async()=>{
      const members=g.members.filter(u=>u!==me),admins=g.admins.filter(u=>u!==me);
      try{await setDoc(doc(fs,"groups",gid),{...g,members,admins:admins.length||!members.length?admins:[members[0]]});
        delete groups[gid];closeChat();toast("Gruptan çıktın")}catch(e){toast("Çıkılamadı")}})};
    $("#iList").onclick=e=>{const b=e.target.closest("[data-remove]");if(!b)return;e.preventDefault();const u=b.dataset.remove;
      openModal({title:"Üyeyi çıkar",text:`${esc(realName(u))} gruptan çıkarılsın mı?`,input:false,ok:"Çıkar"},async()=>{
        try{await setDoc(doc(fs,"groups",gid),{...g,members:g.members.filter(x=>x!==u),admins:g.admins.filter(x=>x!==u)});toast("Çıkarıldı")}catch(e){toast("Çıkarılamadı")}})};
  }else{
    const u=users[cur]||{};
    $("#iAv").innerHTML=avHTML(cur);$("#iName").textContent=realName(cur);$("#iSub").textContent=u.code?"TR ID "+fmtCode(u.code):"";
    $("#iLabel").textContent="";
    const common=Object.entries(groups).filter(([,g])=>g.members.includes(cur));
    $("#iList").innerHTML=common.length?`<div class="fl" style="padding:0 8px">Ortak gruplar</div>`+common.map(([id,g])=>`<div class="gitem" data-g="${esc(id)}">${avHTML("g:"+id)}<div class="gn"><b>${esc(g.name)}</b><span>${g.members.length} üye</span></div></div>`).join(""):"";
    $("#iActs").innerHTML=`<button class="pri" id="iClose">Kapat</button>`;
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
window.addEventListener("popstate",()=>{if($("#viewer").classList.contains("show")){closeViewer();return}if(cur)closeChat()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#viewer").classList.contains("show")){closeViewer();return}if(cur&&!document.querySelector(".modal.show")&&!$("#story.show"))$("#back").click()});
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  tabNow=t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="pane-"+tabNow));
  $("#fab").innerHTML=tabNow==="chats"?'<svg viewBox="0 0 24 24"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';
});
$("#btnSearch").onclick=()=>{const sb=$("#searchbar");sb.classList.toggle("show");if(sb.classList.contains("show"))$("#searchInput").focus();else{query_="";$("#searchInput").value="";renderChats()}};
$("#searchInput").oninput=e=>{query_=e.target.value.toLocaleLowerCase("tr").trim();if(tabNow!=="chats")document.querySelector('[data-tab="chats"]').click();renderChats()};
document.querySelector(".content").onclick=e=>{const r=e.target.closest(".row");if(!r)return;
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
overlay.onclick=()=>{if(modal.dataset.locked==="1"||profileLocked)return;closeAll();closeProfile();closeGroupModal();closeInfo()};
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
    text:`${prefix}<div class="idbox">${esc(fmtCode(c)||"…")}</div>Bu numarayı arkadaşına ver. O da “ID ile kişi ekle”den seni ekleyip yazabilir.`},
    async()=>{try{await navigator.clipboard.writeText(c);toast("ID kopyalandı")}catch(e){toast("Kopyalanamadı — numarayı elle yaz")}});
}
function askAdd(){openModal({title:"ID ile kişi ekle",text:"Arkadaşının 6 haneli TR ID'sini yaz.",placeholder:"örn. 482 913",ok:"Ekle",numeric:true},addById)}
menu.onclick=e=>{const a=e.target.dataset.act;if(!a)return;closeAll();
  if(a==="myid")showMyId();
  if(a==="add")askAdd();
  if(a==="newgroup")openGroupModal("create");
  if(a==="profile")askProfile(false);
  if(a==="readall"){chatEntries().forEach(x=>markRead(x.c));toast("Tümü okundu")}
  if(a==="dark"){dark=!dark;document.body.classList.toggle("dark",dark);try{localStorage.setItem("tr-dark",dark?"1":"0")}catch(e){}}
  if(a==="logout")openModal({title:"Çıkış yap",text:"Hesabından çıkmak istiyor musun?",input:false,ok:"Çıkış yap"},logout);
};
$("#fab").onclick=()=>{if(tabNow==="status")askStatus();else askAdd()};

/* ---------- profil / ID ---------- */
function cleanUser(x){return{nick:typeof x.nick==="string"?x.nick.slice(0,62):"",first:typeof x.first==="string"?x.first.slice(0,30):"",last:typeof x.last==="string"?x.last.slice(0,30):"",code:/^\d{6}$/.test(x.code)?x.code:"",pub:validPub(x.pub)?{x:x.pub.x,y:x.pub.y}:null,joined:+x.joined||0}}
function cleanGroup(x){if(!x||!Array.isArray(x.members))return null;return{name:typeof x.name==="string"?x.name.slice(0,50):"Grup",members:x.members.filter(u=>typeof u==="string").slice(0,MAX_GROUP),admins:Array.isArray(x.admins)?x.admins.filter(u=>typeof u==="string"):[],createdBy:String(x.createdBy||""),at:+x.at||0}}
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
  $("#pOk").disabled=true;$("#pErr").textContent="";
  let ok=true;
  try{
    if(ph!==myPhone){await setDoc(privRef(),{phone:ph},{merge:true});myPhone=ph}
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
function stopAll(){unsubs.forEach(u=>{try{u()}catch(e){}});unsubs=[];watched.clear()}

const watched=new Set();
function watchUser(uid){
  if(!uid||watched.has(uid)||!me)return;watched.add(uid);
  unsubs.push(onSnapshot(doc(fs,"users",uid),s=>{if(s.exists()){users[uid]=cleanUser(s.data());decryptAll();renderAll();if(uid===me)updateIdLabel()}},()=>{}));
  unsubs.push(onSnapshot(doc(fs,"statuses",uid),s=>{const x=s.exists()?s.data():null;if(x&&x.text)statuses[uid]={text:String(x.text).slice(0,300),at:+x.at||0,bg:/^#[0-9a-fA-F]{6}$/.test(x.bg)?x.bg:"#111"};else delete statuses[uid];renderStatus()},()=>{}));
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

  watchUser(me);
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
  },err=>{banner("Mesajlar yüklenemedi: "+(err.code||err.message))}));
  unsubs.push(onSnapshot(query(collection(fs,"reads"),where("members","array-contains",me)),s=>{
    s.docs.forEach(d=>{const x=d.data();if(x&&typeof x.at==="number"){if(d.id.startsWith(me+"_"))reads[d.id]=Math.max(reads[d.id]||0,x.at);else reads[d.id]=x.at}});
    renderAll()},()=>{}));
});

/* ---------- başlık bildirimi ---------- */
let firstSnap=true;
function notifyNew(s){
  if(firstSnap){firstSnap=false;return}
  const n=s.docChanges().filter(c=>c.type==="added"&&c.doc.data().from!==me&&!c.doc.metadata.hasPendingWrites).length;
  if(n&&document.hidden){document.title=`(${n}) TR`}
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)document.title="TR"});

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))}
