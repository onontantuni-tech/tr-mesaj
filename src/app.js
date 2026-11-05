import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot } from "firebase/firestore";
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
function previewText(c){if(!c)return"🔒 Mesaj";if(c.t==="game")return"🀄 Okey daveti";if(c.t==="img")return"📷 Fotoğraf";if(c.t==="voice")return"🎤 Sesli mesaj"+(c.dur?" ("+fmtDur(c.dur)+")":"");if(c.t==="sys")return c.text;return c.text||""}
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
  $("#acallBtn").style.display=$("#vcallBtn").style.display=isGroupConv(cur)?"none":"";
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
  if(c.t==="game")return`<div class="gamecard" data-game="${esc(c.gid)}"><span class="gi">🀄</span><div><b>Okey masası</b><span>Dokun, masaya otur</span></div><span class="go">Masaya git</span></div>`;
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
window.addEventListener("popstate",()=>{if($("#viewer").classList.contains("show")){closeViewer();return}if(game)return;if(cur)closeChat()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#viewer").classList.contains("show")){closeViewer();return}if(cur&&!document.querySelector(".modal.show")&&!$("#story.show"))$("#back").click()});
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  tabNow=t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="pane-"+tabNow));
  if(tabNow==="calls")renderCalls();
  $("#fab").innerHTML=tabNow==="chats"||tabNow==="calls"?'<svg viewBox="0 0 24 24"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';
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
overlay.onclick=()=>{if(modal.dataset.locked==="1"||profileLocked)return;closeAll();closeProfile();closeGroupModal();closeInfo();closeContacts()};
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
  if(a==="findcontacts")findContacts();
  if(a==="notif")notifMenu();
  if(a==="profile")askProfile(false);
  if(a==="readall"){chatEntries().forEach(x=>markRead(x.c));toast("Tümü okundu")}
  if(a==="dark"){dark=!dark;document.body.classList.toggle("dark",dark);try{localStorage.setItem("tr-dark",dark?"1":"0")}catch(e){}}
  if(a==="logout")openModal({title:"Çıkış yap",text:"Hesabından çıkmak istiyor musun?",input:false,ok:"Çıkış yap"},logout);
};
$("#fab").onclick=()=>{if(tabNow==="status")askStatus();else askAdd()};
document.querySelector(".content").addEventListener("click",e=>{const r=e.target.closest("[data-callback]");if(r)startCall(r.dataset.callback,r.dataset.video==="1")});

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
  syncPhone().catch(()=>{});
  setupPush(false).catch(()=>{});

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
async function gameApi(body){
  const r=await callApi("/api/game",body).catch(e=>({error:e.status===409?"busy":"net"}));
  return r;
}
$("#gameBtn").onclick=()=>{if(!cur)return;closeAll();overlay.classList.add("show");$("#gpick").classList.add("show")};
$("#gpickClose").onclick=()=>{$("#gpick").classList.remove("show");overlay.classList.remove("show")};
$("#gpick").addEventListener("click",async e=>{
  const it=e.target.closest("[data-newgame]");if(!it||!cur)return;
  const conv=cur;$("#gpick").classList.remove("show");overlay.classList.remove("show");
  toast("Masa kuruluyor…",2500);
  const r=await gameApi({action:"create",type:it.dataset.newgame,conv});
  if(!r||!r.id){toast("Masa kurulamadı, tekrar dene");return}
  await sendContent(conv,{t:"game",gid:r.id,kind:"okey"});
  openGame(r.id);
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
  game.poke=setInterval(()=>{const d=game&&game.data;if(!d||d.status!=="play")return;const s=d.seats[d.turn];if(s&&!s.bot&&s.uid!==me&&Date.now()-(d.lastMoveAt||0)>47000)gameApi({action:"poke",id})},10000);
}
function closeGame(silent){
  if(!game)return;game.unsubs.forEach(u=>{try{u()}catch(e){}});clearInterval(game.poke);game=null;
  $("#gamescr").classList.remove("show");
}
$("#gBack").onclick=()=>{try{if(history.state&&history.state.game){history.back();return}}catch(e){}closeGame()};
window.addEventListener("popstate",()=>{if(game&&!(history.state&&history.state.game))closeGame()});
$("#gLeave").onclick=()=>{if(!game)return;const id=game.id;openModal({title:"Masadan kalk",text:game.data&&game.data.status==="play"?"Yerine bilgisayar oyuncu geçecek.":"Masadan kalkmak istiyor musun?",input:false,ok:"Kalk"},async()=>{await gameApi({action:"leave",id});closeGame()})};

function mySeatIdx(d){return(d.seats||[]).findIndex(s=>s&&!s.bot&&s.uid===me)}
function renderGame(){
  if(!game||!game.data)return;
  const d=game.data,my=mySeatIdx(d);
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
    html+=`<div class="seat p-${p} ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(s)}<div class="nm">${esc(seatName(s))}</div><div class="ct">${(d.handCounts||[])[i]??""} taş · ${(d.scores||[])[i]||0} puan</div></div>`});
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
    html+=`<div class="overbox"><b style="font-size:18px">${w==null?"El berabere bitti":(w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı")}</b><div style="font-size:13px;opacity:.85">${esc(d.log||"")}${d.points?" · +"+d.points+" puan":""}</div>${d.winHand?`<div class="wh">${[...d.winHand].sort((a,b)=>(tIsWild(a,ok)-tIsWild(b,ok))||(tIsFake(a)?ok.c*100+ok.n:tColor(a)*100+tNum(a))-(tIsFake(b)?ok.c*100+ok.n:tColor(b)*100+tNum(b))).map(t=>tileHTML(t,ok,{sm:true})).join("")}</div>`:""}<div class="sc">${d.seats.map((s,i)=>`<span>${esc(seatName(s))}: <b>${(d.scores||[])[i]||0}</b></span>`).join("")}</div>${d.host===me?`<button id="gAgain">Yeni el</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni eli masa sahibi başlatır</div>`}</div>`;
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
  $("#gRack").style.display=my>=0?"":"none";$("#gActions").style.display=my>=0&&d.status==="play"?"":"none";
  $("#gDiscard").disabled=!(canDiscard&&game.sel!=null)||game.busy;
  $("#gFinish").disabled=!(canDiscard&&game.sel!=null)||game.busy;
  const pile=$("#gPile");if(pile)pile.onclick=()=>canDraw&&gameMove({action:"draw",from:"pile"});
  const ld=$("#gLeftDisc");if(ld)ld.onclick=()=>canDraw&&gameMove({action:"draw",from:"left"});
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
function renderLobby(d,my){
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#gMsg").textContent="";
  if(d.status==="closed"){$("#gTable").innerHTML='<div class="lobby">Masa kapandı.</div>';return}
  const seats=d.seats.map(s=>`<div class="st">${seatAv(s)}<span>${esc(s?seatName(s):"Boş · bilgisayar oturur")}</span></div>`).join("");
  const host=d.host===me,free=d.seats.some(s=>!s);
  $("#gTable").innerHTML=`<div class="lobby"><div style="font-size:40px">🀄</div><b style="font-size:20px">Okey masası</b><div class="seats">${seats}</div>${my<0?(free?'<button id="gJoin">Masaya otur</button>':'<div>Masa dolu</div>'):host?'<button id="gStart">Oyunu başlat</button><div style="font-size:12.5px;opacity:.8">Boş yerlere bilgisayar oturur</div>':'<div style="opacity:.85">Masa sahibinin başlatması bekleniyor…</div>'}</div>`;
  const j=$("#gJoin");if(j)j.onclick=()=>gameMove({action:"join"});
  const st=$("#gStart");if(st)st.onclick=()=>gameMove({action:"start"});
}
async function gameMove(body){
  if(!game||game.busy)return;const id=game.id;game.busy=true;renderGame();
  const r=await gameApi({...body,id});
  if(game&&game.id===id){game.busy=false;
    if(r&&r.error==="nowin")toast("El bitmiyor. Taşlar seri ya da çift oluşturmalı.",3000);
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
  for(const u of sel){watchUser(u);await saveContact(u)}
  if(sel.length)toast(sel.length+" kişi eklendi");
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
