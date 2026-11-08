import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, arrayUnion, collection, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
import * as P from "../netlify/lib/pool.mjs";
import * as OK from "../netlify/lib/okey.mjs";
import * as TV from "../netlify/lib/tavla.mjs";
import { hasBad, clean as cleanText } from "../netlify/lib/filter.mjs";
import qrcode from "qrcode-generator";
import { getMessaging, getToken, isSupported as messagingSupported } from "firebase/messaging";
const VAPID_KEY="BNM0muk8JDXqc6KXABvndnLVHQHpYG-EKDet1qC6zkJq21tbM1P3y6sFlms3sSobLPmGBVkh1sbNQoZKo0s5N5w";

const firebaseConfig = {
  apiKey: "AIzaSyCjT6jaye-XKeBVI-GI_E-qpyAa_w9XzCo",
  // Kendi alan adımızda giriş: /__/auth Vercel üzerinden Firebase'e yönlendirilir (mobil tarayıcılarda yönlendirmeli giriş kaybolmasın)
  authDomain: /\.vercel\.app$/.test(location.hostname) ? location.host : "trtr-f0f6d.firebaseapp.com",
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
let vipU={};const bdg={};   // uid -> {ach:[], gifts:{}} (badges/{uid})

let blocked={};
let prefs={mute:{},arch:[],pin:[],fav:[],star:[],pinMsg:{},noRead:false,vis:"all",oncev:[]};
const readsHidden={},ctSeen={};
let chatFilter="all",msgQuery="",replyTo=null;
let hidMsgs=new Set();try{hidMsgs=new Set(JSON.parse(localStorage.getItem("tr-hid")||"[]"))}catch(e){}
const RX=["❤️","😂","👍","😮","😢","🙏"];       // engellediğim kişiler
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
const packContent=c=>c.t==="text"&&!c.r&&!c.fwd?c.text:"\u0001"+JSON.stringify(c);
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
async function sendContent(conv,content,{blob,mime,meta,men}={}){
  const at=Date.now();
  const ref=doc(collection(fs,"msgs"));
  const pv={id:ref.id,from:me,at,conv,content:{...content,_local:blob?URL.createObjectURL(blob):null},pending:true};
  pending.push(pv);renderMsgs();renderChats();
  try{
    const {key,aad,base}=await prepareSend(conv,at);
    if(men&&men.length&&base.gid)base.men=men.slice(0,50);
    {const ttl=content.t==="ttl"?0:convTTL(conv);if(ttl)base.exp=at+ttl}
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
      else if(c.t==="vnote"){const v=document.createElement("video");v.className="vnote";v.src=url;v.playsInline=true;v.loop=true;v.muted=true;v.autoplay=true;v.onclick=()=>{v.muted=!v.muted;if(!v.muted){v.currentTime=0;v.play()}};el.replaceWith(v)}
      else if(c.t==="voice"){const a=document.createElement("audio");a.controls=true;a.preload="metadata";a.src=url;a.playbackRate=SET.vspeed||1;a.onplay=()=>{a.playbackRate=SET.vspeed||1};el.replaceWith(a)}
    });
  });
}

/* ---------- görünüm ve sohbet ayarları (cihazda saklanır) ---------- */
const SET_DEF={fs:16,theme:"kirmizi",wall:"nokta",left:false,vspeed:1,autoImg:true,vib:true,hidePush:false};
let SET={...SET_DEF};try{SET={...SET_DEF,...JSON.parse(localStorage.getItem("tr-set")||"{}")}}catch(e){}
const THEMES={kirmizi:["#D7261E","Kırmızı"],lacivert:["#1d4ed8","Lacivert"],yesil:["#0E7C3A","Yeşil"],mor:["#7c3aed","Mor"],turuncu:["#ea580c","Turuncu"],siyah:["#27272a","Siyah"]};
const WALLS={nokta:"Noktalı",duz:"Düz",cini:"Çini",gece:"Gece",kahve:"Kahve",ay:"Ay yıldız"};
function applySet(){const b=document.body;b.style.setProperty("--msgfs",SET.fs+"px");
  const th=THEMES[SET.theme]||THEMES.kirmizi;b.style.setProperty("--brand",th[0]);b.style.setProperty("--brand2",th[0]);
  Object.keys(WALLS).forEach(k=>b.classList.toggle("wall-"+k,SET.wall===k));b.classList.toggle("lefty",!!SET.left);
  document.querySelectorAll("audio").forEach(a=>{a.playbackRate=SET.vspeed||1});
  const mt=document.querySelector('meta[name="theme-color"]');if(mt)mt.content=th[0]}
function saveSet(p){SET={...SET,...p};try{localStorage.setItem("tr-set",JSON.stringify(SET))}catch(e){}applySet()}
applySet();
function openSettings(){
  const seg=(k,opts)=>`<div class="seg" data-k="${k}">${opts.map(([v,l])=>`<button data-v="${v}" class="${String(SET[k])===String(v)?"on":""}">${l}</button>`).join("")}</div>`;
  const tog=(k,l,d)=>`<label class="tgl"><span><b>${l}</b>${d?`<small>${d}</small>`:""}</span><input type="checkbox" data-t="${k}" ${SET[k]?"checked":""}></label>`;
  openInfoModal("⚙️ Ayarlar",`<div class="fl">Yazı boyutu</div>${seg("fs",[[14,"Küçük"],[16,"Normal"],[18,"Büyük"],[21,"Çok büyük"]])}
    <div class="fl">Tema rengi</div><div class="seg col" data-k="theme">${Object.entries(THEMES).map(([k,[c,l]])=>`<button data-v="${k}" class="${SET.theme===k?"on":""}" style="--c:${c}"><i></i>${l}</button>`).join("")}</div>
    <div class="fl">Sohbet duvar kâğıdı</div>${seg("wall",Object.entries(WALLS))}
    <div class="fl">Sesli mesaj hızı</div>${seg("vspeed",[[1,"1x"],[1.5,"1,5x"],[2,"2x"]])}
    ${tog("autoImg","Fotoğrafları otomatik indir","Kapalıyken fotoğraflar dokununca iner (düşük internet / veri tasarrufu)")}
    ${tog("hq","Fotoğrafları yüksek kalitede gönder","Daha net ama daha çok internet harcar")}
    ${tog("vib","Titreşim","Oyunda sıra gelince ve mesajda")}
    ${tog("stt","Sesli mesajları yazıya çevir","Kayıt sırasında tarayıcının konuşma tanıması kullanılır (Google sunucularına gidebilir). Yazı mesajla birlikte şifreli gönderilir.")}
    ${tog("left","Solak modu","Oyun butonları sola geçer")}
    ${tog("hidePush","Bildirimde içerik gizle","Kilit ekranında sadece \"Yeni mesaj\" yazar")}
    <div class="row2"><button id="setTest" style="background:#555">🎙️ Mikrofon ve kamera testi</button></div>
    <div class="fl">Gizlenecek kelimeler</div><input id="setWords" maxlength="300" placeholder="virgülle ayır: spoiler, maç sonucu" value="${esc(SET.words||"")}">`);
  $("#setTest").onclick=()=>{closeE();deviceTest()};
  $("#setWords").onchange=e=>{saveSet({words:e.target.value.slice(0,300)});if(cur)renderMsgs()};
  $("#eBody").onclick=e=>{const b=e.target.closest(".seg button");if(!b)return;const k=b.closest(".seg").dataset.k;let v=b.dataset.v;if(k==="fs"||k==="vspeed")v=+v;saveSet({[k]:v});
    b.closest(".seg").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));if(cur)renderMsgs()};
  $("#eBody").onchange=e=>{const t=e.target.dataset.t;if(!t)return;saveSet({[t]:e.target.checked});if(t==="hidePush")setDoc(doc(fs,"private",me,"data","push"),{hide:e.target.checked},{merge:true}).catch(()=>{})};
}
/* ---------- kaydedilen mesajlar (kendine not) ---------- */
async function loadNotes(){try{const s=await getDoc(doc(fs,"private",me,"data","notes"));return s.exists()&&Array.isArray(s.data().items)?s.data().items:[]}catch(e){return[]}}
async function addNote(text){const items=await loadNotes();items.unshift({t:String(text).slice(0,4000),at:Date.now()});await setDoc(doc(fs,"private",me,"data","notes"),{items:items.slice(0,300)});}
async function openNotes(){const items=await loadNotes();
  openInfoModal("📝 Kaydedilen mesajlar",`<div class="row2"><input id="nIn" maxlength="4000" placeholder="Kendine not yaz…"><button id="nAdd" style="background:var(--brand)">Ekle</button></div>
    <div id="nList">${items.length?items.map((x,i)=>`<div class="pk note"><div style="flex:1;white-space:pre-wrap">${linkify(esc(x.t))}<div class="isub">${new Date(x.at).toLocaleString("tr-TR",{dateStyle:"short",timeStyle:"short"})}</div></div><button data-del="${i}" class="lnk">✕</button></div>`).join(""):'<div class="empty">Henüz kayıt yok. Mesajlara uzun basıp “Kaydet” diyebilir ya da buraya not yazabilirsin. Notlar sadece sende görünür.</div>'}</div>`);
  $("#nAdd").onclick=async()=>{const v=$("#nIn").value.trim();if(!v)return;await addNote(v);openNotes()};
  $("#nList").onclick=async e=>{const b=e.target.closest("[data-del]");if(!b)return;const it=await loadNotes();it.splice(+b.dataset.del,1);await setDoc(doc(fs,"private",me,"data","notes"),{items:it});openNotes()}}
/* ---------- anket ve etkinlik (oylar mesajın pv alanında: {uid: seçenek}) ---------- */
function openPollMaker(conv){
  openInfoModal("📊 Anket oluştur",`<input id="plQ" maxlength="200" placeholder="Soru"><div id="plOpts">${[1,2,3].map(i=>`<input class="plo" maxlength="80" placeholder="Seçenek ${i}">`).join("")}</div>
    <button id="plMore" class="lnkb">+ Seçenek ekle</button><div class="row2"><button id="plGo" style="background:var(--brand)">Gönder</button></div>`);
  $("#plMore").onclick=()=>{const n=$("#plOpts").children.length;if(n>=10)return;$("#plOpts").insertAdjacentHTML("beforeend",`<input class="plo" maxlength="80" placeholder="Seçenek ${n+1}">`)};
  $("#plGo").onclick=async()=>{const q=$("#plQ").value.trim(),o=[...document.querySelectorAll(".plo")].map(x=>x.value.trim()).filter(Boolean);
    if(!q||o.length<2){toast("Soru ve en az 2 seçenek yaz");return}if(hasBad(q+" "+o.join(" "))){toast("Uygunsuz kelime var");return}closeE();await sendContent(conv,{t:"poll",q,o})}}
function openEventMaker(conv){
  const d=new Date(Date.now()+86400e3);d.setMinutes(0);const iso=new Date(d-d.getTimezoneOffset()*60e3).toISOString().slice(0,16);
  openInfoModal("📅 Etkinlik oluştur",`<input id="evT" maxlength="100" placeholder="Etkinlik adı (ör. Cuma akşamı okey)"><label class="fl">Ne zaman?</label><input id="evW" type="datetime-local" value="${iso}"><input id="evP" maxlength="100" placeholder="Yer (isteğe bağlı)"><div class="row2"><button id="evGo" style="background:var(--brand)">Gönder</button></div>`);
  $("#evGo").onclick=async()=>{const t=$("#evT").value.trim(),w=new Date($("#evW").value).getTime(),pl=$("#evP").value.trim();if(!t||!w){toast("Ad ve tarih gerekli");return}if(hasBad(t+" "+pl)){toast("Uygunsuz kelime var");return}closeE();await sendContent(conv,{t:"event",title:t,when:w,place:pl})}}
function pollHTML(m,c){const opts=c.t==="event"?["✅ Katılıyorum","❌ Katılamıyorum"]:(Array.isArray(c.o)?c.o.slice(0,10):[]);const pv=m.pv||{};
  const cnt=opts.map((_,i)=>Object.values(pv).filter(v=>v===i).length),tot=cnt.reduce((a,b)=>a+b,0)||1,mine=pv[me];
  const head=c.t==="event"?`<div class="evh"><b>📅 ${esc(String(c.title||"").slice(0,100))}</b><span>${new Date(+c.when||0).toLocaleString("tr-TR",{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}${c.place?" · 📍 "+esc(String(c.place).slice(0,100)):""}</span></div>`:`<b>📊 ${esc(String(c.q||"").slice(0,200))}</b>`;
  return`<div class="poll" data-poll="${esc(m.id)}">${head}${opts.map((o,i)=>`<button data-vote="${i}" class="${mine===i?"on":""}"><i style="width:${Math.round(100*cnt[i]/tot)}%"></i><span>${esc(String(o).slice(0,80))}</span><b>${cnt[i]||""}</b></button>`).join("")}${c.t==="event"&&+c.when>Date.now()?`<button class="evrem" data-remind="${esc(m.id)}">⏰ Hatırlat</button>`:""}</div>`}
$("#msgs").addEventListener("click",async e=>{
  const fc=e.target.closest("[data-file]");if(fc){const id=fc.dataset.file,c=plain[id]||{};fc.querySelector("span:last-child")&&(fc.querySelector("div span").textContent="İndiriliyor…");const url=await loadMedia(id);
    if(!url){toast("Belge açılamadı");return}const a=document.createElement("a");a.href=url;a.download=String(c.name||"belge").replace(/[\\/:*?"<>|]/g,"_");document.body.appendChild(a);a.click();a.remove();fc.querySelector("div span").textContent=fmtSize(+c.size||0)+" · indirildi";return}
  const uf=e.target.closest("[data-unfilt]");if(uf){const m=msgById(uf.dataset.unfilt);if(m){m._show=1;renderMsgs()}return}
  const ac=e.target.closest("[data-addcode]");if(ac){addById(ac.dataset.addcode);return}
  const oc=e.target.closest("[data-openc]");if(oc){openChat(oc.dataset.openc);return}
  const li=e.target.closest("[data-li]");if(li){const id=li.closest("[data-list]").dataset.list,m=msgById(id);if(!m)return;const ck={...(m.ck||{})};const k=li.dataset.li;if(li.checked)ck[k]=me;else delete ck[k];m.ck=ck;renderMsgs();
    try{await updateDoc(doc(fs,"msgs",id),{ck})}catch(err){toast("Güncellenemedi")}return}
  const v=e.target.closest("[data-vote]");if(v){const id=v.closest("[data-poll]").dataset.poll,m=msgById(id);if(!m)return;const i=+v.dataset.vote;
    const pv={...(m.pv||{})};if(pv[me]===i)delete pv[me];else pv[me]=i;m.pv=pv;renderMsgs();
    try{await updateDoc(doc(fs,"msgs",id),{pv})}catch(err){toast("Oy verilemedi")}return}
  const r=e.target.closest("[data-remind]");if(r){const m=msgById(r.dataset.remind),c=m&&contentOf(m);if(!c)return;addReminder(+c.when-30*60e3,`📅 ${c.title} 30 dakika sonra`);toast("Etkinlikten 30 dakika önce hatırlatacağım")}
});
/* basit hatırlatıcı: uygulama açıkken bildirir */
function reminders(){try{return JSON.parse(localStorage.getItem("tr-rem")||"[]")}catch(e){return[]}}
function addReminder(at,text){const r=reminders().filter(x=>x.at>Date.now()-60e3);r.push({at,text});localStorage.setItem("tr-rem",JSON.stringify(r.slice(-50)))}
setInterval(()=>{const now=Date.now(),r=reminders(),due=r.filter(x=>x.at<=now);if(!due.length)return;localStorage.setItem("tr-rem",JSON.stringify(r.filter(x=>x.at>now)));
  due.forEach(x=>{toast("⏰ "+x.text,6000);try{if(Notification.permission==="granted")new Notification("TR hatırlatma",{body:x.text})}catch(e){}})},20000);
/* ---------- kişi kartı, toplu mesaj, kelime filtresi ---------- */
function pickFriends(title,okText,cb,{multi=true,extra=""}={}){
  const list=Object.keys(friends).filter(isFriend).sort((a,b)=>realName(a).localeCompare(realName(b),"tr"));
  openInfoModal(title,`${extra}<div class="flist pickl">${list.map(u=>`<label class="gitem">${avHTML(u)}<div class="gn"><b>${esc(realName(u))}</b></div><input type="${multi?"checkbox":"radio"}" name="pf" value="${esc(u)}"></label>`).join("")||'<div class="empty">Henüz arkadaşın yok</div>'}</div><div class="row2"><button id="pfOk" style="background:var(--brand)">${okText}</button></div>`);
  $("#pfOk").onclick=()=>{const sel=[...document.querySelectorAll('.pickl input:checked')].map(x=>x.value);if(!sel.length){toast("Kimseyi seçmedin");return}const ex=$("#pfText")?$("#pfText").value:"";closeE();cb(sel,ex)}}
function shareContact(uid){pickFriends("👤 Kişiyi kime gönderelim?","Gönder",async sel=>{const u=users[uid]||{};for(const to of sel){if(to===uid)continue;await sendContent(to,{t:"contact",uid,code:u.code||"",name:(u.nick||"").slice(0,62)})}toast("Kişi kartı gönderildi")})}
function openBroadcast(){pickFriends("📣 Toplu mesaj","Hepsine gönder",async(sel,text)=>{text=String(text||"").trim();if(!text){toast("Mesaj yazmadın");return}
  if(hasBad(text)){toast("Mesajda uygunsuz kelime var");return}let n=0;for(const to of sel.slice(0,50)){if(await sendContent(to,{t:"text",text}))n++}toast(`${n} kişiye ayrı ayrı gönderildi`)},{extra:'<textarea id="pfText" maxlength="2000" rows="3" placeholder="Mesajın (her kişiye ayrı sohbet olarak gider)" style="width:100%;margin-bottom:8px"></textarea>'})}
const wordFilter=()=>String(SET.words||"").split(",").map(x=>x.trim().toLocaleLowerCase("tr")).filter(x=>x.length>1);
function filtered(text){const w=wordFilter();if(!w.length)return false;const t=String(text||"").toLocaleLowerCase("tr");return w.some(x=>t.includes(x))}
/* ---------- tanıtım turu, duyuru, hata raporu, geri bildirim, puan isteme, yeni sürüm ---------- */
function showTour(){if(localStorage.getItem("tr-tour"))return;localStorage.setItem("tr-tour","1");
  const P=[["🔒","Uçtan uca şifreli","Mesajların ve aramaların sadece sen ve karşındakinde açılır. Sunucu bile okuyamaz."],["🤝","Arkadaşını ekle","TR ID'ni, @kullanıcı adını ya da QR kodunu paylaş. İstek kabul edilince yazışırsınız."],["🀄","Oyun sekmesi","Okey, Bilardo, Pişti ve Tavla. Her gün hediye, lig, turnuva ve kulüpler seni bekliyor."],["⚙️","Sana göre","Menü → Ayarlar'dan yazı boyutu, tema ve duvar kâğıdını değiştir."]];
  let i=0;const draw=()=>{openInfoModal("",`<div class="tour"><div class="ti">${P[i][0]}</div><b>${P[i][1]}</b><p>${P[i][2]}</p><div class="dots">${P.map((_,k)=>`<i class="${k===i?"on":""}"></i>`).join("")}</div><div class="row2"><button id="tNext" style="background:var(--brand)">${i<P.length-1?"İleri":"Başla"}</button></div></div>`);
    $("#tNext").onclick=()=>{i++;if(i<P.length)draw();else closeE()}};draw()}
let noticeShown="";
onSnapshot(doc(fs,"config","app"),s=>{const n=s.exists()?s.data().notice:null;
  {const ev=s.exists()?s.data().event:null;window.__event=ev&&ev.until>Date.now()?ev:null;const eb=$("#eventBar");if(eb){if(window.__event){eb.className="dailybar show evt";eb.innerHTML=`🎉 <b>${esc(window.__event.name)}</b> etkinliği: günlük hediye <b>x${window.__event.mul}</b><span>${fmtWait(window.__event.until-Date.now())}</span>`;eb.onclick=()=>openDaily()}else eb.classList.remove("show")}}const bar=$("#noticeBar");if(!bar)return;
  if(!n||!n.text||localStorage.getItem("tr-notice-x")===String(n.at)){bar.classList.remove("show");return}
  bar.className="noticebar show "+(n.kind==="maint"?"maint":"");bar.innerHTML=`<span>${n.kind==="maint"?"🛠️":"📢"} ${esc(n.text)}</span><button aria-label="Kapat">✕</button>`;
  bar.querySelector("button").onclick=()=>{localStorage.setItem("tr-notice-x",String(n.at));bar.classList.remove("show")}},()=>{});
{let sent=0;const rep=(msg,src)=>{if(!me||sent>=5)return;sent++;try{addDoc(collection(fs,"errors"),{uid:me,msg:String(msg).slice(0,500),src:String(src||"").slice(0,300),ua:navigator.userAgent.slice(0,200),at:Date.now(),v:1})}catch(e){}};
  window.addEventListener("error",e=>rep(e.message,(e.filename||"")+":"+(e.lineno||"")));window.addEventListener("unhandledrejection",e=>rep("promise: "+(e.reason&&e.reason.message||e.reason),""))}
function openFeedback(){const G=["101 Okey","Batak","King","Satranç","Dama","Kızma Birader","Domino","Tombala"];
  openInfoModal("💬 Görüşün bizim için önemli",`<div class="fl">Sıradaki oyun ne olsun?</div><div class="seg" id="fbVote">${G.map(g=>`<button data-v="${g}">${g}</button>`).join("")}</div>
    <div class="fl">Önerin ya da şikâyetin</div><textarea id="fbText" maxlength="1000" rows="4" style="width:100%" placeholder="Yaz, okuyoruz…"></textarea><div class="row2"><button id="fbGo" style="background:var(--brand)">Gönder</button></div>`);
  let vote="";$("#fbVote").onclick=e=>{const b=e.target.closest("button");if(!b)return;vote=b.dataset.v;$("#fbVote").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b))};
  $("#fbGo").onclick=async()=>{const text=$("#fbText").value.trim();if(!vote&&!text){toast("Bir oyun seç ya da bir şey yaz");return}
    try{await setDoc(doc(fs,"feedback",me),{...(vote?{vote}:{}),...(text?{text}:{}),at:Date.now()});closeE();toast("Teşekkürler! 🙏")}catch(e){toast("Gönderilemedi")}}}
function maybeAskRating(){if(localStorage.getItem("tr-rated")||!wallet||(wallet.wins||0)<5)return;localStorage.setItem("tr-rated","1");
  openModal({title:"TR'yi beğendin mi? ⭐",text:"Birkaç saniyeni ayırıp Play Store'da puan verirsen çok seviniriz.",input:false,ok:"Puan ver",cancelText:"Sonra"},()=>{window.open("https://play.google.com/store/apps/details?id=com.trtr.mesaj","_blank")})}
if("serviceWorker" in navigator){navigator.serviceWorker.addEventListener("controllerchange",()=>{if(window.__swReady){const bar=$("#noticeBar");if(bar){bar.className="noticebar show";bar.innerHTML='<span>✨ Yeni sürüm hazır</span><button id="nbReload">Yenile</button>';$("#nbReload").onclick=()=>location.reload()}}});
  navigator.serviceWorker.ready.then(()=>{window.__swReady=!!navigator.serviceWorker.controller}).catch(()=>{})}
function dailyBanner(){const el=$("#dailyBar");if(!el)return;if(!wallet||tabNow!=="chats"){el.classList.remove("show");return}
  if(dailyAvailable()){el.className="dailybar show";el.innerHTML=`🎁 <b>Günün ödülü hazır!</b><span>Al ›</span>`;el.onclick=()=>openDaily()}
  else{const ms=new Date(new Date(Date.now()+3*3600e3).toISOString().slice(0,10)+"T00:00:00Z").getTime()+86400e3-3*3600e3-Date.now();el.className="dailybar show soft";el.innerHTML=`🎁 Yeni günlük ödüle <b>${fmtWait(ms)}</b>`;el.onclick=()=>openDaily()}}
setInterval(dailyBanner,60000);
/* ---------- tebrik kartları ve TR çıkartmaları ---------- */
const CARDS={bayram:["🌙","Bayramınız kutlu olsun","Nice güzel bayramlara","linear-gradient(135deg,#0E7C3A,#064e24)"],yilbasi:["🎄","Mutlu yıllar","Yeni yıl sağlık ve mutluluk getirsin","linear-gradient(135deg,#1d4ed8,#0b2a6b)"],dogum:["🎂","İyi ki doğdun","Nice mutlu yıllara","linear-gradient(135deg,#db2777,#7c1d4b)"],gecmis:["💐","Geçmiş olsun","Acil şifalar dilerim","linear-gradient(135deg,#7c3aed,#3b1a75)"],tebrik:["🎉","Tebrikler","Başarılarının devamını dilerim","linear-gradient(135deg,#ea580c,#7c2d12)"],cuma:["🕌","Hayırlı cumalar","Dualarınız kabul olsun","linear-gradient(135deg,#0f766e,#064e3b)"],anne:["🌷","Anneler Günün kutlu olsun","Seni çok seviyorum","linear-gradient(135deg,#e11d48,#831843)"],sevgi:["❤️","Seni seviyorum","","linear-gradient(135deg,#D7261E,#7a0a10)"]};
const STK={eyv:["🤝","Eyvallah"],cay:["🫖","Çay?"],hadi:["🏃","Hadi bakalım"],maşallah:["🧿","Maşallah"],kolay:["💪","Kolay gelsin"],ayıp:["🙈","Ayıp ayıp"],sağol:["🙏","Sağ ol"],okey:["🀄","Okey attım!"],mars:["🎲","Mars oldun"],kahve:["☕","Bir kahve?"],gül:["😂","Güldürme"],tamam:["👌","Tamamdır"]};
function openCards(conv){openInfoModal("💌 Tebrik kartı",`<div class="stkgrid">${Object.entries(CARDS).map(([k,c])=>`<button data-card="${k}"><div class="tcard" style="background:${c[3]};width:auto;padding:8px 4px"><div class="te" style="font-size:28px">${c[0]}</div><span>${c[1]}</span></div></button>`).join("")}</div>`);
  $("#eBody").onclick=e=>{const b=e.target.closest("[data-card]");if(!b)return;closeE();sendContent(conv,{t:"card",k:b.dataset.card})}}
function openStickers(conv){openInfoModal("🧿 TR çıkartmaları",`<div class="stkgrid">${Object.entries(STK).map(([k,v])=>`<button data-stk="${k}"><div class="stkr" style="transform:none"><span class="se" style="font-size:40px">${v[0]}</span><span class="st" style="font-size:12px">${v[1]}</span></div></button>`).join("")}</div>`);
  $("#eBody").onclick=e=>{const b=e.target.closest("[data-stk]");if(!b)return;closeE();sendContent(conv,{t:"stk",k:b.dataset.stk})}}
/* ---------- güvenlik numarası: iki tarafın açık anahtarlarından ---------- */
async function safetyNumber(peer){const a=users[me]?.pub,b=users[peer]?.pub;if(!a||!b)return null;
  const parts=[me+":"+a.x+a.y,peer+":"+b.x+b.y].sort().join("|");const h=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(parts)));
  let out="";for(let i=0;i<12;i++){out+=String(((h[i*2]<<8)|h[i*2+1])%100000).padStart(5,"0")+(i%4===3?"\n":" ")}return out.trim()}
async function showSafety(peer){const n=await safetyNumber(peer);if(!n){toast("Anahtar hazır değil");return}
  openInfoModal("🔐 Güvenlik numarası",`<p class="isub">${esc(realName(peer))} ile aynı numarayı görüyorsanız konuşmanız uçtan uca şifreli ve araya kimse girmemiş demektir. Yüz yüzeyken karşılaştırın ya da QR'ı okutun.</p><div class="safen">${esc(n).replace(/\n/g,"<br>")}</div><div class="qrbox">${qrSVG("TRSAFE:"+n.replace(/\s/g,""))}</div>`)}
/* ---------- uygulama kilidi ve sohbet kilidi (PIN, cihazda saklanır) ---------- */
async function pinHash(p){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("tr-pin:"+(me||"")+":"+p));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")}
const pinSet=()=>!!localStorage.getItem("tr-pin");
const lockedChats=()=>{try{return JSON.parse(localStorage.getItem("tr-lockc")||"[]")}catch(e){return[]}};
let unlockedChats=new Set(),lastHide=0;
function askPin(title,cb){let v="";const dots=()=>{$("#lDots").innerHTML=Array.from({length:4},(_,i)=>`<i class="${i<v.length?"on":""}"></i>`).join("")};
  $("#lockscr .lbox b").textContent=title;$("#lErr").textContent="";$("#lPad").innerHTML=[1,2,3,4,5,6,7,8,9,"✕",0,"⌫"].map(k=>`<button data-k="${k}">${k}</button>`).join("");dots();$("#lockscr").classList.add("show");
  $("#lPad").onclick=async e=>{const b=e.target.closest("[data-k]");if(!b)return;const k=b.dataset.k;if(k==="✕"){if(title!=="TR kilitli"){$("#lockscr").classList.remove("show")}return}if(k==="⌫"){v=v.slice(0,-1);dots();return}
    v+=k;dots();if(v.length===4){const ok=await cb(v);if(ok)$("#lockscr").classList.remove("show");else{$("#lErr").textContent="Yanlış PIN";v="";dots();try{navigator.vibrate&&navigator.vibrate(120)}catch(_){}}}}}
async function checkPin(v){return (await pinHash(v))===localStorage.getItem("tr-pin")}
function lockApp(){if(pinSet())askPin("TR kilitli",checkPin)}
document.addEventListener("visibilitychange",()=>{if(document.hidden)lastHide=Date.now();else if(pinSet()&&Date.now()-lastHide>60000&&lastHide){unlockedChats=new Set();lockApp()}});
function openLockSettings(){openInfoModal("🔒 Uygulama kilidi",`<p class="isub">PIN sadece bu cihazda saklanır. Uygulama 1 dakikadan uzun arka planda kalınca PIN sorar. Kilitli sohbetler de bu PIN ile açılır.</p>
  <div class="row2"><button id="pinSet" style="background:var(--brand)">${pinSet()?"PIN'i değiştir":"PIN belirle"}</button>${pinSet()?'<button id="pinOff" style="background:#555">Kilidi kapat</button>':""}</div>`);
  $("#pinSet").onclick=()=>{closeE();askPin("Yeni PIN (4 hane)",async v=>{const first=v;setTimeout(()=>askPin("PIN'i tekrar gir",async w=>{if(w!==first){toast("PIN'ler uyuşmadı");return true}localStorage.setItem("tr-pin",await pinHash(w));toast("🔒 Uygulama kilidi açıldı");return true}),50);return true})};
  if($("#pinOff"))$("#pinOff").onclick=()=>{closeE();askPin("Mevcut PIN",async v=>{if(!(await checkPin(v)))return false;localStorage.removeItem("tr-pin");localStorage.removeItem("tr-lockc");toast("Kilit kapatıldı");return true})}}
/* ---------- sohbete özel bildirim sesi (uygulama açıkken) ---------- */
const TONES=[["Klasik",[880,1320]],["Damla",[1200,900,600]],["Zil",[1568,1568,2093]],["Kuş",[2000,2400,2000,2600]],["Sessiz",[]]];
const tonesMap=()=>{try{return JSON.parse(localStorage.getItem("tr-tones")||"{}")}catch(e){return{}}};
function playTone(i){const t=TONES[i]||TONES[0];if(!t[1].length)return;try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const now=actx.currentTime;t[1].forEach((f,k)=>{const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=f;g.gain.setValueAtTime(.1,now+k*.11);g.gain.exponentialRampToValueAtTime(.001,now+k*.11+.12);o.connect(g).connect(actx.destination);o.start(now+k*.11);o.stop(now+k*.11+.13)})}catch(e){}}
let seenMsgIds=null;
function notifyIncoming(){const ids=new Set(raw.map(m=>m.id));if(!seenMsgIds){seenMsgIds=ids;return}
  const fresh=raw.filter(m=>!seenMsgIds.has(m.id)&&m.from!==me&&Date.now()-m.at<60000);seenMsgIds=ids;
  if(!fresh.length||document.hidden)return;const m=fresh[fresh.length-1],c=convOfMsg(m);if(c===cur||(prefs.mute[c]||0)>Date.now())return;playTone(tonesMap()[c]||0)}
/* ---------- bağlantılar ---------- */
function linkify(h){return h.replace(/\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`)}
function linkCard(text){const m=String(text||"").match(/https?:\/\/[^\s]+/);if(!m)return"";let u;try{u=new URL(m[0])}catch(e){return""}
  if(!/^https?:$/.test(u.protocol))return"";const host=u.hostname.replace(/^www\./,"");
  return`<a class="lcard" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer nofollow"><i class="lci">🔗</i><span><b>${esc(host)}</b><small>${esc((u.pathname+u.search).slice(0,60))}</small></span></a>`}

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
  const img=avUrl(c);
  if(img)return`<div class="av" style="${st}background-color:${colorOf(c)};background-image:url(${img})"></div>`;
  return`<div class="av" style="${st}background:${colorOf(c)}">${esc(initials(n))}</div>`;
}
/* profil fotoğrafları: avatars/{uid} (herkese açık, küçük JPEG); users/{uid}.av sürüm damgası */
const avCache={};let avQ=new Set(),avT=0,avRT=0;
try{Object.assign(avCache,JSON.parse(localStorage.getItem("tr-avc")||"{}"))}catch(e){}
function avUrl(uid){const v=users[uid]?.av;if(!v)return"";const c=avCache[uid];
  if(c&&c.at===v)return /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.img)?c.img:"";
  if(!avQ.has(uid)){avQ.add(uid);clearTimeout(avT);avT=setTimeout(fetchAvatars,40)}
  return c&&/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.img)?c.img:""}
async function fetchAvatars(){const list=[...avQ];avQ=new Set();let got=false;
  await Promise.all(list.map(async uid=>{try{const s=await getDoc(doc(fs,"avatars",uid));
    if(s.exists()){const d=s.data();if(typeof d.img==="string"){avCache[uid]={img:d.img,at:+d.at||0};got=true}}
    else{avCache[uid]={img:"",at:users[uid]?.av||0}}}catch(e){}}));
  if(got){saveAvCache();clearTimeout(avRT);avRT=setTimeout(()=>{try{renderAll()}catch(e){}},60)}}
function saveAvCache(){try{const ks=Object.keys(avCache);if(ks.length>80)ks.slice(0,ks.length-80).forEach(k=>delete avCache[k]);localStorage.setItem("tr-avc",JSON.stringify(avCache))}catch(e){}}
function shrinkImage(file,size=192){return new Promise((res,rej)=>{const im=new Image(),u=URL.createObjectURL(file);
  im.onload=()=>{URL.revokeObjectURL(u);const c=document.createElement("canvas");c.width=c.height=size;const x=c.getContext("2d");
    const m=Math.min(im.width,im.height);x.drawImage(im,(im.width-m)/2,(im.height-m)/2,m,m,0,0,size,size);
    let q=.85,d=c.toDataURL("image/jpeg",q);while(d.length>45000&&q>.4){q-=.1;d=c.toDataURL("image/jpeg",q)}res(d)};
  im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("img"))};im.src=u})}
let pAvNew=null;
async function saveAvatar(img){const at=Date.now();
  if(img){await setDoc(doc(fs,"avatars",me),{img,at});avCache[me]={img,at}}
  else{try{await deleteDoc(doc(fs,"avatars",me))}catch(e){}delete avCache[me]}
  saveAvCache();return img?at:0}
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
  const read=!m.gid&&!prefs.noRead&&!readsHidden[m.to+"_"+me]&&(reads[m.to+"_"+me]||0)>=m.at;
  return`<svg class="tk ${read?"read":""}" viewBox="0 0 16 11"><path d="M1 6l3 3 6-7"/><path d="M6 9l1 0 6-7"/></svg>`;
}
const contentOf=m=>m.pending?m.content:(plain[m.id]??null);
const GIFT_FALLBACK=[{id:"cay",icon:"☕",name:"Çay",price:500},{id:"gul",icon:"🌹",name:"Gül",price:2000},{id:"pasta",icon:"🎂",name:"Pasta",price:5000},{id:"kupa",icon:"🏆",name:"Kupa",price:15000},{id:"tac",icon:"👑",name:"Taç",price:25000},{id:"elmas",icon:"💎",name:"Elmas",price:100000}];
const giftList=()=>catalog?.gifts||GIFT_FALLBACK,giftOf=id=>giftList().find(x=>x.id===id);
const GKIND={pool:["🎱","Bilardo"],pisti:["🃏","Pişti"],tavla:["🎲","Tavla"],batak:["♠️","Batak"],kizma:["🎯","Kızma Birader"],okey:["🀄","Okey"]};const gk=k=>GKIND[k]||GKIND.okey;
function previewText(c){if(!c)return"🔒 Mesaj";if(c.t==="game")return gk(c.kind)[0]+" "+gk(c.kind)[1]+" daveti";if(c.t==="gift"){const G=giftOf(c.id);return G?G.icon+" "+G.name+" hediyesi":"🎁 Hediye"}if(c.t==="ttl")return"⏱️ Kaybolan mesajlar: "+ttlLabel(+c.v||0);if(c.t==="gres")return gk(c.kind)[0]+" "+gk(c.kind)[1]+" sonucu";if(c.t==="poll")return"📊 "+String(c.q||"Anket");if(c.t==="list")return"📝 "+String(c.title||"Liste");if(c.t==="contact")return"👤 Kişi: "+String(c.name||"");if(c.t==="file")return"📄 "+String(c.name||"Belge");if(c.t==="card")return"💌 "+((CARDS[c.k]||[])[1]||"Kart");if(c.t==="stk")return"🧿 "+((STK[c.k]||[])[1]||"Çıkartma");if(c.t==="loc")return"📍 Konum";if(c.t==="vnote")return"🎥 Video mesaj";if(c.t==="event")return"📅 "+String(c.title||"Etkinlik");if(c.t==="img")return"📷 Fotoğraf";if(c.t==="voice")return"🎤 Sesli mesaj"+(c.dur?" ("+fmtDur(c.dur)+")":"");if(c.t==="sys")return c.text;return c.text||""}
function toast(t,ms=2200){const el=$("#toast");el.textContent=t;el.classList.add("show");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),ms)}
function banner(t){const b=$("#banner");if(t){b.textContent=t;b.classList.add("show")}else b.classList.remove("show")}
/* kaybolan mesajlar: sohbetteki en son {t:"ttl"} mesajı süreyi belirler; yeni mesajlara exp yazılır */
const TTL_OPTS=[[0,"Kapalı"],[86400e3,"24 saat"],[7*86400e3,"7 gün"],[90*86400e3,"90 gün"]];
const ttlLabel=v=>(TTL_OPTS.find(x=>x[0]===v)||[0,"Kapalı"])[1];
function convTTL(c){let best=null;for(const m of raw){if(convOfMsg(m)!==c)continue;const ct=plain[m.id];if(ct&&ct.t==="ttl"&&(!best||m.at>best.at))best={at:m.at,v:+ct.v||0}}return best?best.v:0}
const alive=m=>!(m.exp&&m.exp<Date.now());
function openTTL(c){openInfoModal("⏱️ Kaybolan mesajlar",`<p class="isub">Açıkken bu sohbete gönderilen yeni mesajlar seçtiğin süre sonunda herkesten silinir. Daha önce gönderilenler etkilenmez. Şu an: <b>${ttlLabel(convTTL(c))}</b></p>`+TTL_OPTS.map(([v,l])=>`<div class="pk" data-ttl="${v}" style="cursor:pointer"><b style="flex:1">${l}</b>${convTTL(c)===v?"✅":""}</div>`).join(""));
  $("#eBody").onclick=async e=>{const r=e.target.closest("[data-ttl]");if(!r)return;const v=+r.dataset.ttl;closeE();if(v===convTTL(c))return;await sendContent(c,{t:"ttl",v})}}
setInterval(()=>{if(raw.some(m=>m.exp&&m.exp<Date.now()&&!m._gone)){raw.forEach(m=>{if(m.exp&&m.exp<Date.now())m._gone=1});try{renderAll()}catch(e){}}},30000);
function convMsgs(c){return raw.filter(m=>convOfMsg(m)===c&&alive(m)).concat(pending.filter(m=>m.conv===c)).sort((a,b)=>a.at-b.at)}
function unreadOf(c){const last=reads[me+"_"+c]||0;return raw.filter(m=>m.from!==me&&convOfMsg(m)===c&&m.at>last&&alive(m)).length}

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
  const arch=new Set(prefs.arch),archN=list.filter(e=>arch.has(e.c)).length;
  if(!q){
    if(chatFilter==="arch")list=list.filter(e=>arch.has(e.c));else list=list.filter(e=>!arch.has(e.c));
    if(chatFilter==="unread")list=list.filter(e=>e.unread);
    if(chatFilter==="groups")list=list.filter(e=>isGroupConv(e.c));
    if(chatFilter==="fav")list=list.filter(e=>prefs.fav.includes(e.c));
    list.sort((a,b)=>(prefs.pin.includes(b.c)-prefs.pin.includes(a.c))||(b.at-a.at));
  }
  const drafts=(()=>{try{return JSON.parse(localStorage.getItem("tr-drafts")||"{}")}catch(e){return{}}})();
  const chips=`<div class="chips">${[["all","Tümü"],["unread","Okunmamış"],["groups","Gruplar"],["fav","Favoriler"]].map(([k,t])=>`<button data-cf="${k}" class="${chatFilter===k?"on":""}">${t}</button>`).join("")}${archN||chatFilter==="arch"?`<button data-cf="arch" class="${chatFilter==="arch"?"on":""}">Arşiv (${archN})</button>`:""}</div>`;
  const reqHtml=reqs.length&&!q?`<div class="section">Arkadaşlık istekleri (${reqs.length})</div>`+reqs.map(u=>`<div class="row" data-open="${esc(u)}">${avHTML(u)}<div class="meta"><div class="l1"><span class="name">${esc(realName(u))}</span></div><div class="l2"><span class="prev">${users[u]?.code?"TR ID "+esc(fmtCode(users[u].code)):"İstek gönderdi"}</span></div></div><div class="frbtns"><button class="ok" data-frok="${esc(u)}">Kabul</button><button class="no" data-frno="${esc(u)}">Reddet</button></div></div>`).join("")+(list.length?`<div class="section">Sohbetler</div>`:""):"";
  const html=reqHtml+list.map(e=>{
    const l=e.last,g=isGroupConv(e.c);let prev;
    if(drafts[e.c]&&e.c!==cur)prev=`<span class="prev"><b style="color:#E53935">Taslak:</b> ${esc(drafts[e.c].slice(0,60))}</span>`;
    else if(l){const who=l.from===me?tick(l)+" ":(g?esc(realName(l.from).split(" ")[0])+": ":"");prev=`<span class="prev">${who}${esc(previewText(contentOf(l)))}</span>`}
    else prev=`<span class="prev">${g?"Grup oluşturuldu":(isBlocked(e.c)?"Engellendi":isFriend(e.c)?"Mesaj göndermek için dokun":esc(friendNote(e.c)))}</span>`;
    return`<div class="row" data-open="${esc(e.c)}"${e.c===cur?' style="background:var(--bg)"':''}>${avHTML(e.c)}
      <div class="meta"><div class="l1"><span class="name">${esc(e.title)}${g?"":vipMark(e.c)}</span><span class="time ${e.unread?"unread":""}">${(prefs.mute[e.c]||0)>Date.now()?"🔕 ":""}${prefs.pin.includes(e.c)?"📌 ":""}${e.at?when(e.at):""}</span></div>
      <div class="l2">${prev}${e.unread?`<span class="badge">${e.unread>99?"99+":e.unread}</span>`:""}</div></div></div>`}).join("");
  $("#pane-chats").innerHTML=(q?"":chips)+(html||(q?`<div class="empty">Sonuç bulunamadı</div>`:chatFilter!=="all"?`<div class="empty">Bu filtrede sohbet yok</div>`:
    `<div class="empty">Henüz sohbetin yok.<br><br>Senin TR ID'n:<div class="idbox" style="margin:12px auto;max-width:220px">${esc(fmtCode(users[me]?.code)||"…")}</div>Arkadaşının ID'sini eklemek için <b>+</b> düğmesine dokun.</div>`));
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
  if(isGroupConv(cur)){const g=groups[gidOf(cur)];$("#cSub").textContent=g?g.members.map(realName).join(", "):"Bu gruptan çıkarıldın";
    const lock=!!(g&&g.adminOnly&&!g.admins.includes(me));$("#composer").classList.toggle("locked",lock);$("#composer").dataset.lockmsg="🔒 Bu grupta sadece yöneticiler mesaj gönderebilir"}
  else{$("#composer").classList.remove("locked");const code=users[cur]?.code;$("#cSub").textContent=code?"TR ID: "+fmtCode(code):"";renderPresence()}
}
function bubbleBody(m,c){
  if(!c)return(m.id in plain)?'<i style="opacity:.7">🔒 Bu mesaj çözülemedi</i>':'<i style="opacity:.6">🔒 …</i>';
  if(c.t==="img"&&c.once){
    if(m.from===me)return`<div class="oncemsg">① Tek seferlik fotoğraf</div>`;
    if(prefs.oncev.includes(m.id))return`<div class="oncemsg dim">① Fotoğraf açıldı</div>`;
    return`<div class="oncemsg" data-once="${esc(m.id)}">① Tek seferlik fotoğrafı aç</div>`}
  if(c.t==="img"){
    if(c._local)return`<img class="media" src="${esc(c._local)}" alt="Fotoğraf">`;
    if(!SET.autoImg&&!mediaUrl[m.id])return`<div class="mload tap" data-tapmedia="${esc(m.id)}"${c.w&&c.h?` style="aspect-ratio:${+c.w}/${+c.h};height:auto"`:""}>📷 Fotoğrafı indirmek için dokun</div>`;
    const ar=c.w&&c.h?` style="aspect-ratio:${+c.w}/${+c.h};height:auto"`:"";
    return`<div class="mload" data-media="${esc(m.id)}"${ar}>📷 Yükleniyor…</div>`;
  }
  if(c.t==="ttl")return`<div class="sysnote">⏱️ Kaybolan mesajlar <b>${esc(ttlLabel(+c.v||0))}</b>${+c.v?" · yeni mesajlar bu süre sonunda silinir":" · kapatıldı"}</div>`;
  if(c.t==="poll"||c.t==="event")return pollHTML(m,c);
  if(c.t==="list"){const ck=m.ck||{};return`<div class="poll slist" data-list="${esc(m.id)}"><b>📝 ${esc(String(c.title||"Liste").slice(0,80))}</b>${(Array.isArray(c.items)?c.items:[]).slice(0,30).map((it,i)=>`<label class="sli ${ck[i]?"done":""}"><input type="checkbox" data-li="${i}" ${ck[i]?"checked":""}><span>${esc(String(it).slice(0,100))}</span>${ck[i]&&ck[i]!==me?`<small>${esc(realName(ck[i]).split(" ")[0])}</small>`:""}</label>`).join("")}</div>`}
  if(c.t==="card"){const C=CARDS[c.k];if(C)return`<div class="tcard" style="background:${C[3]}"><div class="te">${C[0]}</div><b>${esc(C[1])}</b><span>${esc(C[2])}</span></div>`}
  if(c.t==="stk"){const S=STK[c.k];if(S)return`<div class="stkr"><span class="se">${S[0]}</span><span class="st">${esc(S[1])}</span></div>`}
  if(c.t==="file")return`<div class="fcard" data-file="${esc(m.id)}"><span class="fi">📄</span><div><b>${esc(String(c.name||"belge").slice(0,80))}</b><span>${fmtSize(+c.size||0)} · dokun, indir</span></div></div>`;
  if(c.t==="loc"){const la=+c.lat,ln=+c.lng;if(isFinite(la)&&isFinite(ln))return`<a class="loccard" href="https://www.openstreetmap.org/?mlat=${la.toFixed(5)}&mlon=${ln.toFixed(5)}#map=17/${la.toFixed(5)}/${ln.toFixed(5)}" target="_blank" rel="noopener noreferrer"><span class="lp">📍</span><div><b>Konum</b><span>${la.toFixed(4)}, ${ln.toFixed(4)} · haritada aç</span></div></a>`}
  if(c.t==="vnote"){if(c._local)return`<video class="vnote" src="${esc(c._local)}" playsinline loop muted autoplay></video>`;return`<div class="mload vnote" data-media="${esc(m.id)}">🎥</div>`}
  if(c.t==="contact")return`<div class="ccard">${avHTML(c.uid)}<div><b>${esc(String(c.name||"Kişi").slice(0,62))}</b><span>${c.code&&/^\d{6}$/.test(c.code)?"TR ID "+esc(fmtCode(c.code)):""}</span></div>${c.uid!==me&&!isFriend(c.uid)&&/^\d{6}$/.test(c.code||"")?`<button data-addcode="${esc(c.code)}">Ekle</button>`:c.uid!==me?`<button data-openc="${esc(c.uid)}">Mesaj</button>`:""}</div>`;
  if(c.t==="gres")return`<div class="gamecard res"><span class="gi">${gk(c.kind)[0]}</span><div><b>${gk(c.kind)[1]} bitti</b><span>${c.draw?"Berabere":"🏆 "+esc(String(c.w||"").slice(0,40))+" kazandı"}${+c.pot?" · "+fmtCoin(+c.pot)+" jeton":""}</span></div></div>`;
  if(c.t==="gift"){const G=giftOf(c.id);if(G)return`<div class="giftmsg"><span>${G.icon}</span><b>${esc(G.name)}</b><small>hediye</small></div>`}
  if(c.t==="game")return`<div class="gamecard" data-game="${esc(c.gid)}"><span class="gi">${gk(c.kind)[0]}</span><div><b>${gk(c.kind)[1]} masası</b><span>${c.stake?"Masa ücreti "+(+c.stake).toLocaleString("tr-TR")+" jeton":"Ücretsiz masa"}</span></div><span class="go">Masaya git</span></div>`;
  if(c.t==="voice"){
    if(c._local)return`<audio controls src="${esc(c._local)}"></audio>`;
    return`<div class="mload" style="height:44px" data-media="${esc(m.id)}">🎤 Yükleniyor… ${c.dur?fmtDur(c.dur):""}</div>`+(c.tx?`<details class="vtx"><summary>📝 Yazıya çevrilmiş hali</summary>${esc(String(c.tx).slice(0,1000))}</details>`:"");
  }
  if(m.from!==me&&filtered(c.text)&&!m._show)return`<span class="filt" data-unfilt="${esc(m.id)}">🙈 Filtrelenen mesaj · göster</span>`;
  return linkify(esc(c.text))+linkCard(c.text);
}
$("#msgs").addEventListener("click",async e=>{
  const tm=e.target.closest("[data-tapmedia]");if(tm){tm.dataset.media=tm.dataset.tapmedia;tm.removeAttribute("data-tapmedia");tm.textContent="📷 Yükleniyor…";hydrateMedia();return}
  const on=e.target.closest("[data-once]");if(on){const id=on.dataset.once;on.textContent="Açılıyor…";const url=await loadMedia(id);if(!url){toast("Açılamadı");return}
    savePrefs({oncev:[...prefs.oncev,id].slice(-300)});openViewer(url,{once:true})}
});
function renderMsgs(){
  if(!cur)return;
  const box=$("#msgs"),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;
  let list=convMsgs(cur).filter(m=>!hidMsgs.has(m.id));const g=isGroupConv(cur);
  if(msgQuery)list=list.filter(m=>(contentOf(m)?.text||"").toLocaleLowerCase("tr").includes(msgQuery));
  const grp=g?groups[gidOf(cur)]:null;
  let html=`<div class="lock">🔒 Mesajlar uçtan uca şifreli. ${g?"Bu sohbeti sadece grup üyeleri okuyabilir.":"Bu sohbeti sadece sen ve "+esc(realName(cur))+" okuyabilir."}</div>`,lastDay="",prevFrom=null;
  if(!g&&!validPub(users[cur]?.pub))html+=`<div class="day"><span>Bu kişinin şifreleme anahtarı henüz hazır değil.</span></div>`;
  if(g&&!grp)html+=`<div class="day"><span>Artık bu grubun üyesi değilsin.</span></div>`;
  list.forEach(m=>{const d=dayLabel(m.at);if(d!==lastDay){html+=`<div class="day"><span>${d}</span></div>`;lastDay=d;prevFrom=null}
    const mine=m.from===me,c=contentOf(m);
    const who=g&&!mine&&prevFrom!==m.from?`<span class="who" style="color:${colorOf(m.from)}">${esc(realName(m.from))}</span>`:"";
    const extra=c&&c.fwd?'<div class="fw">↪ İletildi</div>':"";
    const rq=c&&c.r?`<div class="rq" data-jump="${esc(c.r.id)}"><b style="color:${colorOf(c.r.from)}">${esc(c.r.from===me?"Sen":realName(c.r.from))}</b><span>${esc(String(c.r.p||"").slice(0,120))}</span></div>`:"";
    const rx=m.rx?Object.values(m.rx).filter(x=>RX.includes(x)):[];
    const rxh=rx.length?`<div class="rxs">${[...new Set(rx)].map(x=>x+(rx.filter(y=>y===x).length>1?rx.filter(y=>y===x).length:"")).join(" ")}</div>`:"";
    const star=prefs.star.includes(m.id)?"⭐ ":"";
    html+=`<div class="b ${mine?"out":"in"} ${c&&c.t==="stk"?"stkb":""} ${m.pending?"pending":""} ${rx.length?"hasrx":""}" data-mid="${esc(m.id)}">${who}${extra}${rq}${bubbleBody(m,c)}<span class="s">${star}${m.ed?"düzenlendi · ":""}${hm(m.at)}${mine?tick(m):""}</span>${rxh}</div><div class="clear"></div>`;
    prevFrom=m.from});
  const pm=prefs.pinMsg[cur]&&raw.find(m=>m.id===prefs.pinMsg[cur]);
  if(pm)html=`<div class="pinbar" data-jump="${esc(pm.id)}">📌 <span>${esc(previewText(contentOf(pm)).slice(0,90))}</span><button data-unpin="1" aria-label="Sabitlemeyi kaldır">✕</button></div>`+html;
  if(msgQuery&&!list.length)html+=`<div class="day"><span>“${esc(msgQuery)}” bulunamadı</span></div>`;
  box.innerHTML=html;
  hydrateMedia();
  if(atBottom||list.length!==lastRenderedCount)box.scrollTop=box.scrollHeight;
  lastRenderedCount=list.length;
  const okFriend=renderFriendBar();
  const canSend=g?!!grp:okFriend;
  $("#composer").style.display=canSend?"":"none";
}
function renderAll(){renderBell();renderChats();renderStatus();if(tabNow==="calls")renderCalls();if(cur){renderChatHeader();renderMsgs()}}

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
  try{await setDoc(doc(fs,"reads",id),prefs.noRead?{members:[me,c],at:latest,h:true}:{members:[me,c],at:latest})}catch(e){}
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
  if(/^\s*@?[a-zA-Z_][a-zA-Z0-9_]{2,19}\s*$/.test(String(input))&&/[a-zA-Z_]/.test(String(input)))return addByName(String(input).trim());
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

/* ---------- mesaj işlemleri: yanıtla, ilet, düzenle, sil, tepki, yıldız, sabitle ---------- */
async function savePrefs(patch){prefs={...prefs,...patch};renderAll();try{await setDoc(doc(fs,"private",me,"data","prefs"),patch,{merge:true})}catch(e){toast("Kaydedilemedi")}}
function saveDraft(){if(!cur)return;try{const d=JSON.parse(localStorage.getItem("tr-drafts")||"{}");const v=$("#msgInput").value.trim();if(v)d[cur]=v.slice(0,500);else delete d[cur];localStorage.setItem("tr-drafts",JSON.stringify(d))}catch(e){}}
function renderReplyBar(){const b=$("#replybar");if(!replyTo){b.classList.remove("show");b.innerHTML="";return}
  b.innerHTML=`<div class="rq"><b style="color:${colorOf(replyTo.from)}">${esc(replyTo.from===me?"Sen":realName(replyTo.from))}</b><span>${esc(replyTo.p)}</span></div><button type="button" id="replyX" aria-label="Yanıtı iptal et">✕</button>`;
  b.classList.add("show");$("#replyX").onclick=()=>{replyTo=null;renderReplyBar()}}
const msgById=id=>raw.find(m=>m.id===id)||pending.find(m=>m.id===id);
function jumpTo(id){const el=document.querySelector(`.b[data-mid="${CSS.escape(id)}"]`);if(!el){toast("Mesaj bulunamadı");return}el.scrollIntoView({block:"center",behavior:"smooth"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),1400)}
let sheetFor=null;
function openMsgSheet(id){
  const m=msgById(id);if(!m||m.pending)return;const c=contentOf(m);if(!c)return;
  sheetFor=id;const mine=m.from===me,isText=c.t==="text",canEdit=mine&&isText&&Date.now()-m.at<15*60e3;
  const myRx=m.rx&&m.rx[me];
  $("#msheet").innerHTML=`<div class="rxrow">${RX.map(x=>`<button data-rx="${x}" class="${myRx===x?"on":""}">${x}</button>`).join("")}</div>
    <button data-ma="reply">↩️ Yanıtla</button><button data-ma="fwd">↪️ İlet</button>${isText?'<button data-ma="copy">📋 Kopyala</button><button data-ma="note">📝 Kaydet (notlarım)</button><button data-ma="tr">🌐 Çevir</button>':""}<button data-ma="remind">⏰ Hatırlat</button>
    ${canEdit?'<button data-ma="edit">✏️ Düzenle</button>':""}<button data-ma="star">${prefs.star.includes(id)?"☆ Yıldızı kaldır":"⭐ Yıldızla"}</button>
    <button data-ma="pin">${prefs.pinMsg[cur]===id?"📌 Sabitlemeyi kaldır":"📌 Sabitle"}</button>
    <button data-ma="delme">🗑️ Benden sil</button>${mine?'<button data-ma="delall" class="danger">🗑️ Herkesten sil</button>':""}
    ${!mine?'<button data-ma="report" class="danger">🚩 Şikâyet et</button>':""}`;
  overlay.classList.add("show");$("#msheet").classList.add("show");
}
function closeSheet(){$("#msheet").classList.remove("show");overlay.classList.remove("show");sheetFor=null}
async function react(id,emoji){
  const m=msgById(id);if(!m)return;const rx={...(m.rx||{})};
  if(rx[me]===emoji)delete rx[me];else rx[me]=emoji;
  m.rx=rx;renderMsgs();
  try{await updateDoc(doc(fs,"msgs",id),{rx})}catch(e){toast("Tepki gönderilemedi")}
}
$("#msheet").addEventListener("click",async e=>{
  const id=sheetFor;if(!id)return;const m=msgById(id),c=contentOf(m);
  const r=e.target.closest("[data-rx]");if(r){closeSheet();react(id,r.dataset.rx);return}
  const b=e.target.closest("[data-ma]");if(!b)return;const a=b.dataset.ma;closeSheet();
  if(a==="reply"){replyTo={id,from:m.from,p:previewText(c).slice(0,120)};renderReplyBar();$("#msgInput").focus()}
  if(a==="remind"){openInfoModal("⏰ Hatırlat",[[60,"1 saat sonra"],[180,"3 saat sonra"],[1440,"Yarın bu saatte"]].map(([mn,l])=>`<div class="pk" data-rm="${mn}" style="cursor:pointer">${l}</div>`).join("")+'<p class="isub">Hatırlatma uygulama açıkken gelir.</p>');
    $("#eBody").onclick=ev=>{const r=ev.target.closest("[data-rm]");if(!r)return;addReminder(Date.now()+ +r.dataset.rm*60e3,previewText(c).slice(0,80));closeE();toast("Hatırlatma kuruldu")};return}
  if(a==="tr"){window.open("https://translate.google.com/?sl=auto&tl=tr&op=translate&text="+encodeURIComponent((c.text||"").slice(0,1500)),"_blank","noopener");return}
  if(a==="note"){try{await addNote(c.text||"");toast("Notlarına kaydedildi")}catch(err){toast("Kaydedilemedi")}}
  if(a==="copy"){try{await navigator.clipboard.writeText(c.text||"");toast("Kopyalandı")}catch(err){toast("Kopyalanamadı")}}
  if(a==="star"){const st=prefs.star.includes(id)?prefs.star.filter(x=>x!==id):[...prefs.star,id].slice(-300);savePrefs({star:st})}
  if(a==="pin"){const pm={...prefs.pinMsg};if(pm[cur]===id)delete pm[cur];else pm[cur]=id;savePrefs({pinMsg:pm})}
  if(a==="delme"){hidMsgs.add(id);try{localStorage.setItem("tr-hid",JSON.stringify([...hidMsgs].slice(-2000)))}catch(err){}renderMsgs();toast("Senden silindi")}
  if(a==="delall")openModal({title:"Herkesten sil",text:"Bu mesaj herkes için silinsin mi?",input:false,ok:"Sil"},async()=>{
    try{if(c.bid)for(let i=0;i<(c.n||0);i++)await deleteDoc(doc(fs,"blobs",c.bid+"_"+i)).catch(()=>{});await deleteDoc(doc(fs,"msgs",id));toast("Silindi")}catch(err){toast("Silinemedi")}});
  if(a==="edit")openModal({title:"Mesajı düzenle",value:c.text,ok:"Kaydet"},async v=>{
    v=v.trim().slice(0,2000);if(!v||v===c.text)return;
    if(Date.now()-m.at>=15*60e3){toast("Mesajlar 15 dakika içinde düzenlenebilir");return}
    const key=msgKey[id];if(!key){toast("Düzenlenemedi");return}
    const nc={...c,text:v},aad=aadOf(m.from,m.gid?"g:"+m.gid:m.to,m.at);
    const {iv,ct}=await aesEnc(key,enc(packContent(nc)),aad);
    plain[id]=nc;renderMsgs();
    try{await setDoc(doc(fs,"msgs",id),{ct:b64(ct),iv:b64(iv),ed:Date.now()},{merge:true})}catch(err){plain[id]=c;renderMsgs();toast("Düzenlenemedi")}});
  if(a==="fwd")openForward(id);
  if(a==="report")openReport(m.from,cur);
});
// uzun basma, sağ tık, çift dokunma
{let lp=null,lpx=0,lpy=0,lastTap=0,lastId="";
  const box=$("#msgs");
  box.addEventListener("contextmenu",e=>{const b=e.target.closest(".b[data-mid]");if(!b)return;e.preventDefault();openMsgSheet(b.dataset.mid)});
  box.addEventListener("touchstart",e=>{const b=e.target.closest(".b[data-mid]");if(!b)return;lpx=e.touches[0].clientX;lpy=e.touches[0].clientY;
    lp=setTimeout(()=>{lp=null;try{SET.vib&&navigator.vibrate&&navigator.vibrate(15)}catch(_){}openMsgSheet(b.dataset.mid)},480)},{passive:true});
  box.addEventListener("touchmove",e=>{if(lp&&(Math.abs(e.touches[0].clientX-lpx)>8||Math.abs(e.touches[0].clientY-lpy)>8)){clearTimeout(lp);lp=null}},{passive:true});
  box.addEventListener("touchend",()=>{if(lp){clearTimeout(lp);lp=null}});
  box.addEventListener("click",e=>{
    const un=e.target.closest("[data-unpin]");if(un){const pm={...prefs.pinMsg};delete pm[cur];savePrefs({pinMsg:pm});return}
    const j=e.target.closest("[data-jump]");if(j){jumpTo(j.dataset.jump);return}
    const b=e.target.closest(".b[data-mid]");if(!b||e.target.closest("audio,img,.gamecard"))return;
    const now=Date.now();if(lastId===b.dataset.mid&&now-lastTap<320){lastTap=0;react(b.dataset.mid,"❤️");return}lastTap=now;lastId=b.dataset.mid});
}
function openForward(id){
  const m=msgById(id),c=contentOf(m);if(!c)return;
  const convs=[...Object.keys(friends).filter(isFriend),...Object.keys(groups).map(g=>"g:"+g)].sort((a,b)=>convTitle(a).localeCompare(convTitle(b),"tr"));
  openInfoModal("İlet",`<div class="flist">${convs.map(cv=>`<label class="gitem"><input type="checkbox" value="${esc(cv)}" style="width:20px;height:20px">${avHTML(cv)}<div class="gn"><b>${esc(convTitle(cv))}</b></div></label>`).join("")||'<div class="isub">İletecek kimse yok</div>'}</div><div class="row2" style="margin-top:8px"><button id="fwdGo" style="background:var(--brand)">Gönder</button></div>`);
  $("#fwdGo").onclick=async()=>{
    const tg=[...document.querySelectorAll('#eBody input[type=checkbox]:checked')].map(x=>x.value).slice(0,5);
    if(!tg.length){toast("En az bir sohbet seç");return}
    $("#fwdGo").disabled=true;
    let blob=null;if(c.bid){const url=await loadMedia(id);if(!url){toast("Medya açılamadı");$("#fwdGo").disabled=false;return}blob=await fetch(url).then(r=>r.blob())}
    for(const t of tg){
      if(blob)await sendContent(t,{t:c.t,fwd:1,...(c.dur?{dur:c.dur}:{})},{blob,mime:c.mime,meta:c.w?{w:c.w,h:c.h}:null});
      else await sendContent(t,{t:"text",text:c.text||previewText(c),fwd:1});
    }
    closeE();toast(tg.length>1?tg.length+" sohbete iletildi":"İletildi");
  };
}
/* sohbet içinde arama */
$("#cSearchBtn").onclick=()=>{const b=$("#csearch");b.classList.toggle("show");if(b.classList.contains("show"))$("#csInput").focus();else{msgQuery="";$("#csInput").value="";renderMsgs()}};
$("#csInput").oninput=e=>{msgQuery=e.target.value.toLocaleLowerCase("tr").trim();renderMsgs()};
/* yıldızlı mesajlar */
function openStarred(){
  const list=prefs.star.map(msgById).filter(Boolean).sort((a,b)=>b.at-a.at);
  openInfoModal("⭐ Yıldızlı mesajlar",list.length?list.map(m=>`<div class="gitem" data-sjump="${esc(m.id)}" data-sconv="${esc(convOfMsg(m))}">${avHTML(m.from===me?me:m.from)}<div class="gn"><b>${esc(m.from===me?"Sen":realName(m.from))} → ${esc(convTitle(convOfMsg(m)))}</b><span>${esc(previewText(contentOf(m)).slice(0,90))} · ${when(m.at)}</span></div></div>`).join(""):'<div class="empty">Yıldızlı mesajın yok. Bir mesaja uzun basıp ⭐ Yıldızla de.</div>');
  $("#eBody").onclick=e=>{const g=e.target.closest("[data-sjump]");if(!g)return;closeE();openChat(g.dataset.sconv);setTimeout(()=>jumpTo(g.dataset.sjump),300)};
}
/* sohbet satırına uzun basma: sabitle, sessize al, arşivle, favori */
function openChatSheet(c){
  const muted=(prefs.mute[c]||0)>Date.now();
  $("#msheet").innerHTML=`<div class="isub" style="padding:4px 8px 8px">${esc(convTitle(c))}</div>
    <button data-ca="pin">${prefs.pin.includes(c)?"📌 Sabitlemeyi kaldır":"📌 Sohbeti sabitle"}</button>
    <button data-ca="fav">${prefs.fav.includes(c)?"☆ Favorilerden çıkar":"⭐ Favorilere ekle"}</button>
    ${muted?'<button data-ca="unmute">🔔 Sesi aç</button>':'<button data-ca="m8">🔕 8 saat sessize al</button><button data-ca="m168">🔕 1 hafta sessize al</button><button data-ca="minf">🔕 Her zaman sessiz</button>'}
    <button data-ca="arch">${prefs.arch.includes(c)?"📤 Arşivden çıkar":"🗄️ Arşivle"}</button>
    <button data-ca="read">✔️ Okundu say</button>
    <button data-ca="tone">🔔 Bildirim sesi: ${esc((TONES[(tonesMap()[c])||0]||TONES[0])[0])}</button>
    <button data-ca="ttl">⏱️ Kaybolan mesajlar · ${esc(ttlLabel(convTTL(c)))}</button>`;
  sheetFor=null;$("#msheet").dataset.conv=c;overlay.classList.add("show");$("#msheet").classList.add("show");
}
$("#msheet").addEventListener("click",e=>{
  const b=e.target.closest("[data-ca]");if(!b)return;const c=$("#msheet").dataset.conv,a=b.dataset.ca;closeSheet();
  if(a==="ttl"){openTTL(c);return}
  if(a==="tone"){openInfoModal("🔔 Bildirim sesi",TONES.map((t,i)=>`<div class="pk" data-tone="${i}" style="cursor:pointer"><b style="flex:1">${t[0]}</b>${(tonesMap()[c]||0)===i?"✅":""}</div>`).join("")+'<p class="isub">Uygulama açıkken bu sohbetten mesaj gelince çalar.</p>');
    $("#eBody").onclick=e=>{const r=e.target.closest("[data-tone]");if(!r)return;const m=tonesMap();m[c]=+r.dataset.tone;localStorage.setItem("tr-tones",JSON.stringify(m));playTone(+r.dataset.tone);closeE()};return}
  const tog=(k)=>prefs[k].includes(c)?prefs[k].filter(x=>x!==c):[...prefs[k],c].slice(-200);
  if(a==="pin"){if(!prefs.pin.includes(c)&&prefs.pin.length>=3){toast("En fazla 3 sohbet sabitlenebilir");return}savePrefs({pin:tog("pin")})}
  if(a==="fav")savePrefs({fav:tog("fav")});
  if(a==="arch")savePrefs({arch:tog("arch")});
  if(a==="read")markRead(c);
  if(a.startsWith("m")||a==="unmute"){const mu={...prefs.mute};if(a==="unmute")delete mu[c];else mu[c]=a==="minf"?8640000000000000:Date.now()+(a==="m8"?8:168)*3600e3;savePrefs({mute:mu});toast(a==="unmute"?"Ses açıldı":"Sessize alındı")}
});
{let lp=null;const list=$("#pane-chats");
  list.addEventListener("contextmenu",e=>{const r=e.target.closest(".row[data-open]");if(!r)return;e.preventDefault();openChatSheet(r.dataset.open)});
  list.addEventListener("touchstart",e=>{const r=e.target.closest(".row[data-open]");if(!r)return;lp=setTimeout(()=>{lp=null;suppressClick=true;try{SET.vib&&navigator.vibrate&&navigator.vibrate(15)}catch(_){}openChatSheet(r.dataset.open)},520)},{passive:true});
  ["touchmove","touchend"].forEach(t=>list.addEventListener(t,()=>{if(lp){clearTimeout(lp);lp=null}},{passive:true}));
}
let suppressClick=false;
document.addEventListener("click",e=>{if(suppressClick){suppressClick=false;e.stopPropagation();e.preventDefault()}},true);

/* ---------- çevrimiçi, yazıyor, son görülme ---------- */
let presUnsub=null,presOf=null,presTimer=null,lastBeat=0,lastTyping=0;
function beat(force){
  if(!me||document.hidden)return;
  const now=Date.now();if(!force&&now-lastBeat<55000)return;lastBeat=now;
  const d=prefs.vis==="none"?{at:0,vis:"none"}:{at:now,vis:prefs.vis};
  setDoc(doc(fs,"presence",me),d,{merge:true}).catch(()=>{});
}
setInterval(()=>beat(false),15000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)beat(true)});
function typing(){
  if(!cur||prefs.vis==="none"||isGroupConv(cur))return;const now=Date.now();if(now-lastTyping<3000)return;lastTyping=now;
  setDoc(doc(fs,"presence",me),{at:now,vis:prefs.vis,ty:cur,tyAt:now},{merge:true}).catch(()=>{});
}
function watchPresence(c){
  if(presUnsub){presUnsub();presUnsub=null}presOf=null;clearInterval(presTimer);
  if(!c||isGroupConv(c))return;
  presUnsub=onSnapshot(doc(fs,"presence",c),s=>{presOf=s.exists()?s.data():null;renderPresence()},()=>{presOf=null});
  presTimer=setInterval(renderPresence,4000);
}
function renderPresence(){
  if(!cur||isGroupConv(cur))return;const p=presOf,now=Date.now();let t="";
  if(p&&prefs.vis!=="none"){
    if(p.ty===me&&now-(p.tyAt||0)<6000)t="yazıyor…";
    else if(p.at&&now-p.at<75000)t="çevrimiçi";
    else if(p.at)t="son görülme "+(when(p.at).includes(":")?"bugün "+hm(p.at):when(p.at)+" "+hm(p.at));
  }
  const code=users[cur]?.code;$("#cSub").textContent=t||(code?"TR ID: "+fmtCode(code):"");$("#cSub").classList.toggle("typing",t==="yazıyor…");
}
/* gizlilik ayarları */
function openPrivacy(){
  const v=prefs.vis;
  openInfoModal("🔒 Gizlilik",`<div class="fl">Çevrimiçi ve son görülme bilgimi görebilenler</div>
    ${[["all","Herkes"],["friends","Sadece arkadaşlarım"],["none","Hiç kimse"]].map(([k,t])=>`<label class="repr"><input type="radio" name="pv" value="${k}" ${v===k?"checked":""}> ${t}</label>`).join("")}
    <p class="isub">"Hiç kimse" seçersen sen de başkalarının çevrimiçi bilgisini göremezsin.</p>
    <label class="repr" style="margin-top:8px"><input type="checkbox" id="pvRead" ${prefs.noRead?"":"checked"}> <span>Okundu bilgisi (mavi tik)<br><span class="isub">Kapatırsan sen de başkalarının okuduğunu göremezsin.</span></span></label>
    <div class="row2" style="margin-top:10px"><button id="pvSave" style="background:var(--brand)">Kaydet</button></div>`);
  $("#pvSave").onclick=()=>{const vis=document.querySelector('input[name="pv"]:checked')?.value||"all";savePrefs({vis,noRead:!$("#pvRead").checked});closeE();setTimeout(()=>beat(true),100);toast("Kaydedildi")};
}
/* medya galerisi ve sohbeti dışa aktarma */
function openGallery(c){
  const imgs=convMsgs(c).filter(m=>!m.pending&&contentOf(m)?.t==="img").reverse().slice(0,60);
  openInfoModal("🖼️ Medya",imgs.length?`<div class="gal">${imgs.map(m=>`<div class="gi" data-media="${esc(m.id)}">…</div>`).join("")}</div>`:'<div class="empty">Bu sohbette fotoğraf yok</div>');
  document.querySelectorAll("#eBody .gi").forEach(el=>{loadMedia(el.dataset.media).then(u=>{if(!u){el.textContent="🔒";return}el.innerHTML=`<img src="${u}" alt="Fotoğraf">`;el.onclick=()=>{closeE();openViewer(u)}})});
}
function exportChat(c){
  const lines=convMsgs(c).filter(m=>!m.pending).map(m=>`[${new Date(m.at).toLocaleString("tr-TR")}] ${m.from===me?(users[me]?.nick||"Ben"):realName(m.from)}: ${previewText(contentOf(m))}`);
  const blob=new Blob(["TR sohbet: "+convTitle(c)+"\n\n"+lines.join("\n")],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="TR-sohbet-"+convTitle(c).replace(/[^\p{L}\p{N}]+/gu,"-")+".txt";document.body.appendChild(a);a.click();a.remove();toast("Sohbet indirildi");
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
const SUPPORT_MAIL="farukplaystore10@gmail.com";

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
  const list=Object.keys(friends).filter(isFriend).sort((a,b)=>realName(a).localeCompare(realName(b),"tr"));setTimeout(()=>loadFriendActivity(list),50);
  openModal({title:"Arkadaşlarım ("+list.length+")",input:false,ok:"Arkadaş ekle",cancelText:"Kapat",
    text:list.length?`<div class="flist">${list.map(u=>`<div class="gitem" data-fopen="${esc(u)}">${avHTML(u)}<div class="gn"><b>${esc(realName(u))}${vipMark(u)}</b><span data-act-of="${esc(u)}">${users[u]?.code?"TR ID "+esc(fmtCode(users[u].code)):""}</span></div></div>`).join("")}</div>`:"Henüz arkadaşın yok. TR ID ile istek gönderebilirsin."},askAdd);
}
function loadFriendActivity(list){list.slice(0,60).forEach(u=>getDoc(doc(fs,"presence",u)).then(s=>{if(!s.exists())return;const p=s.data(),el=document.querySelector(`[data-act-of="${CSS.escape(u)}"]`);if(!el)return;
  const on=p.at&&Date.now()-p.at<120000;if(on&&p.g){el.innerHTML=`<b style="color:#0E7C3A">${gk(p.g)[0]} ${gk(p.g)[1]} oynuyor</b>${p.gid?` · <a href="#" data-joing="${esc(p.gid)}">Katıl / izle</a>`:""}`}else if(on)el.innerHTML='<b style="color:#0E7C3A">● çevrimiçi</b>'}).catch(()=>{}))}
$("#mText").addEventListener("click",e=>{const j=e.target.closest("[data-joing]");if(j){e.preventDefault();e.stopPropagation();closeAll();openGame(j.dataset.joing);return}
  const r=e.target.closest("[data-fopen]");if(r){closeAll();openChat(r.dataset.fopen)}});

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
    $("#iList").innerHTML=g.members.map(u=>memberRow(u,{tag:g.admins.includes(u)?"yönetici":"",remove:admin&&u!==me})+(admin&&u!==me?`<button class="mkadm" data-mkadmin="${esc(u)}">${g.admins.includes(u)?"Yöneticilikten al":"Yönetici yap"}</button>`:"")).join("");
    $("#iActs").innerHTML=(admin?`<button id="iAdd">Üye ekle</button><button id="iRename">Adını değiştir</button>`:"")+`<button id="iMedia">🖼️ Medya</button><button id="iExport">⬇️ Dışa aktar</button><button class="danger" id="iRep">Şikâyet et</button><button class="danger" id="iLeave">Gruptan çık</button><button class="pri" id="iClose">Kapat</button>`;
    $("#iRep").onclick=()=>{closeInfo();openReport(g.createdBy===me?null:g.createdBy,"g:"+gid)};
    $("#iMedia").onclick=()=>{closeInfo();openGallery("g:"+gid)};$("#iExport").onclick=()=>{closeInfo();exportChat("g:"+gid)};
    $("#iActs").insertAdjacentHTML("afterbegin",`<button id="iPoll">📊 Anket</button><button id="iEvent">📅 Etkinlik</button>`+(admin?`<button id="iInv">🔗 Davet bağlantısı</button><button id="iAdm">${g.adminOnly?"💬 Herkes yazabilsin":"🔒 Sadece yöneticiler yazsın"}</button>`:""));
    $("#iPoll").onclick=()=>{closeInfo();openPollMaker("g:"+gid)};$("#iEvent").onclick=()=>{closeInfo();openEventMaker("g:"+gid)};
    if(admin){
      $("#iAdm").onclick=async()=>{closeInfo();try{await setDoc(doc(fs,"groups",gid),{...g,adminOnly:!g.adminOnly});toast(g.adminOnly?"Artık herkes yazabilir":"Artık sadece yöneticiler yazabilir")}catch(e){toast("Kaydedilemedi")}};
      $("#iInv").onclick=async()=>{closeInfo();let inv=g.inv;if(!inv){inv=[...crypto.getRandomValues(new Uint8Array(12))].map(b=>"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%56]).join("");try{await setDoc(doc(fs,"groups",gid),{...g,inv})}catch(e){toast("Bağlantı oluşturulamadı");return}}
        const u=`${location.origin}/?j=${gid}.${inv}`;const t=`TR'de “${g.name}” grubuna katıl: ${u}`;if(navigator.share)navigator.share({text:t,url:u}).catch(()=>{});else{navigator.clipboard?.writeText(u);toast("Davet bağlantısı kopyalandı")}};
      $("#iList").addEventListener("click",async e=>{const b=e.target.closest("[data-mkadmin]");if(!b)return;e.preventDefault();e.stopPropagation();const u=b.dataset.mkadmin;
        const admins=g.admins.includes(u)?g.admins.filter(x=>x!==u):[...g.admins,u];if(!admins.length){toast("En az bir yönetici olmalı");return}
        try{await setDoc(doc(fs,"groups",gid),{...g,admins});toast(admins.includes(u)?"Yönetici yapıldı":"Yöneticilik alındı");closeInfo()}catch(err){toast("Yapılamadı")}},{capture:true});
      $("#iList").querySelectorAll(".row[data-uid], .mrow").forEach(()=>{});
    }
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
    $("#iAv").innerHTML=avHTML(cur);$("#iName").innerHTML=esc(realName(cur))+vipMark(cur);recordView(cur);$("#iSub").textContent=(u.code?"TR ID "+fmtCode(u.code):"")+(u.un?" · @"+u.un:"");
    $("#iLabel").innerHTML=(u.bio?`<div class="ibio">${esc(u.bio)}</div>`:"")+(u.joined?`<div class="ijoin">📅 ${new Date(u.joined).toLocaleDateString("tr-TR",{month:"long",year:"numeric"})} tarihinden beri TR'de</div>`:"");
    {const bd=bdg[cur];const A=catalog?.ach||[];const achH=(bd?.ach||[]).map(a=>A.find(x=>x.id===a)).filter(Boolean).map(x=>`<span title="${esc(x.name)}">${x.icon}</span>`).join("");
      const gH=Object.entries(bd?.gifts||{}).map(([k,n])=>[giftOf(k),+n||0]).filter(([g,n])=>g&&n>0).map(([g,n])=>`<span>${g.icon}<small>${n}</small></span>`).join("");
      const T=(catalog?.titles||[]),ttl=(bd?.titles||[]).map(x=>T.find(y=>y.id===x)).filter(Boolean).map(x=>`<span class="ttl">${x.icon} ${esc(x.name)}</span>`).join("");
      if(ttl)$("#iLabel").innerHTML+=`<div class="ibadges"><div class="irow">${ttl}</div></div>`;
      {const pc=cur;getDoc(doc(fs,"ratings",pc)).then(r=>{if(cur!==pc||!r.exists())return;const u=+r.data().up||0,dn=+r.data().down||0;if(u+dn<3)return;$("#iLabel").insertAdjacentHTML("beforeend",`<div class="ibadges"><div class="fl">Oyuncu puanı</div><div>👍 %${Math.round(100*u/(u+dn))} <span class="isub">(${u+dn} değerlendirme)</span></div></div>`)}).catch(()=>{})}
      $("#iLabel").innerHTML+=(achH?`<div class="ibadges"><div class="fl">Başarımlar</div><div class="irow">${achH}</div></div>`:"")+(gH?`<div class="ibadges"><div class="fl">Aldığı hediyeler</div><div class="irow g">${gH}</div></div>`:"")}
    {const peer=cur;getDocs(query(collection(fs,"gh",me,"g"),where("opp","array-contains",peer),limit(200))).then(s=>{if(cur!==peer)return;let w=0,l=0;s.docs.forEach(d=>{const x=d.data();if(x.draw)return;x.won?w++:l++});
      if(w+l)$("#iLabel").insertAdjacentHTML("beforeend",`<div class="ibadges"><div class="fl">Aranızdaki skor</div><div class="h2h"><b>${w}</b> – <b>${l}</b><small>sen – ${esc(realName(peer).split(" ")[0])}</small></div></div>`)}).catch(()=>{})}
    {const im=avUrl(cur);$("#iAv").onclick=im?()=>{const big=avCache[cur]?.img;if(big)openViewer(big)}:null}
    const common=Object.entries(groups).filter(([,g])=>g.members.includes(cur));
    $("#iList").innerHTML=common.length?`<div class="fl" style="padding:0 8px">Ortak gruplar</div>`+common.map(([id,g])=>`<div class="gitem" data-g="${esc(id)}">${avHTML("g:"+id)}<div class="gn"><b>${esc(g.name)}</b><span>${g.members.length} üye</span></div></div>`).join(""):"";
    const f=friends[cur];
    const bl=isBlocked(cur);
    $("#iActs").innerHTML=`<button id="iSafe">🔐 Güvenlik numarası</button><button id="iLockC">${lockedChats().includes(cur)?"🔓 Sohbet kilidini kaldır":"🔒 Sohbeti kilitle"}</button><button id="iShareC">👤 Kişiyi paylaş</button><button id="iTtl">⏱️ Kaybolan: ${esc(ttlLabel(convTTL(cur)))}</button>`+(isFriend(cur)?`<button id="iGift">🎁 Hediye gönder</button>`:"")+(isFriend(cur)?`<button class="danger" id="iUnf">Arkadaşlıktan çıkar</button>`:"")+`<button id="iMedia">🖼️ Medya</button><button id="iExport">⬇️ Dışa aktar</button><button class="danger" id="iBlock">${bl?"Engeli kaldır":"Engelle"}</button><button class="danger" id="iRep">Şikâyet et</button><button class="pri" id="iClose">Kapat</button>`;
    {const pc=cur;$("#iSafe").onclick=()=>{closeInfo();showSafety(pc)};
      $("#iLockC").onclick=()=>{closeInfo();if(!pinSet()){toast("Önce Menü → Uygulama kilidi'nden PIN belirle",3500);return}const L=lockedChats();localStorage.setItem("tr-lockc",JSON.stringify(L.includes(pc)?L.filter(x=>x!==pc):[...L,pc]));toast(L.includes(pc)?"Sohbet kilidi kaldırıldı":"🔒 Sohbet kilitlendi")};
      $("#iTtl").onclick=()=>{closeInfo();openTTL(pc)};$("#iShareC").onclick=()=>{closeInfo();shareContact(pc)}}
    if($("#iGift")){const peer=cur;$("#iGift").onclick=()=>{closeInfo();openGift(peer)}}
    {const pc=cur;$("#iMedia").onclick=()=>{closeInfo();openGallery(pc)};$("#iExport").onclick=()=>{closeInfo();exportChat(pc)}}
    {const peer=cur;$("#iBlock").onclick=()=>{closeInfo();bl?unblockUser(peer):confirmBlock(peer)};$("#iRep").onclick=()=>{closeInfo();openReport(peer,peer)}}
    if(isFriend(cur)){const peer=cur;$("#iUnf").onclick=()=>{closeInfo();openModal({title:"Arkadaşlıktan çıkar",text:`${esc(realName(peer))} arkadaşlıktan çıkarılsın mı? Tekrar yazışmak için yeni istek gerekir.`,input:false,ok:"Çıkar"},()=>removeFriend(peer))}}
    $("#iList").onclick=e=>{const r=e.target.closest("[data-g]");if(r){closeInfo();openChat("g:"+r.dataset.g)}};
    {const peer=cur;loadHistory().then(rows=>{const vs=rows.filter(r=>(r.opp||[]).includes(peer)&&!r.draw);if(!vs.length||cur!==peer)return;const w=vs.filter(r=>r.won).length;
      $("#iSub").textContent+=` · Aranızdaki skor ${w}-${vs.length-w}`}).catch(()=>{})}
  }
  $("#iClose").onclick=closeInfo;
  overlay.classList.add("show");$("#imodal").classList.add("show");
}
function closeInfo(){$("#imodal").classList.remove("show");overlay.classList.remove("show")}
$("#chatTitle").onclick=openInfo;$("#cAvWrap").onclick=openInfo;

/* ---------- navigation ---------- */
function openChat(c){
  if(lockedChats().includes(c)&&pinSet()&&!unlockedChats.has(c)){askPin("Kilitli sohbet",async v=>{if(!(await checkPin(v)))return false;unlockedChats.add(c);setTimeout(()=>openChat(c),50);return true});return}
  if(cur&&cur!==c)saveDraft();
  cur=c;lastRenderedCount=-1;replyTo=null;renderReplyBar();msgQuery="";$("#csearch").classList.remove("show");
  {let d="";try{d=JSON.parse(localStorage.getItem("tr-drafts")||"{}")[c]||""}catch(e){}$("#msgInput").value=d}
  watchPresence(c);
  $("#emojis").classList.remove("show");
  renderChatHeader();renderMsgs();
  $("#chat").classList.remove("hidden");$("#placeholder").classList.add("off");
  markRead(c);renderChats();updateSendIcon();
  try{if(!history.state||!history.state.chat)history.pushState({chat:c},"");else history.replaceState({chat:c},"")}catch(e){}
}
function closeChat(){saveDraft();watchPresence(null);if(rec)stopRec(false);$("#chat").classList.add("hidden");$("#placeholder").classList.remove("off");cur=null;renderChats()}
$("#back").onclick=()=>{try{if(history.state&&history.state.chat){history.back();return}}catch(e){}closeChat()};
window.addEventListener("popstate",()=>{if($("#viewer").classList.contains("show")){closeViewer();return}if(game)return;if(cur)closeChat()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("#viewer").classList.contains("show")){closeViewer();return}if(cur&&!document.querySelector(".modal.show")&&!$("#story.show"))$("#back").click()});
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  tabNow=t.dataset.tab;setTimeout(dailyBanner,0);
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="pane-"+tabNow));
  if(tabNow==="calls")renderCalls();
  if(tabNow==="games")renderGamesTab();
  $("#fab").innerHTML=tabNow==="chats"||tabNow==="calls"?'<svg viewBox="0 0 24 24"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';
});
$("#btnSearch").onclick=()=>{const sb=$("#searchbar");sb.classList.toggle("show");if(sb.classList.contains("show"))$("#searchInput").focus();else{query_="";$("#searchInput").value="";renderChats()}};
$("#searchInput").oninput=e=>{query_=e.target.value.toLocaleLowerCase("tr").trim();if(tabNow!=="chats")document.querySelector('[data-tab="chats"]').click();renderChats()};
document.querySelector(".content").onclick=e=>{if(friendButtons(e))return;
  const cf=e.target.closest("[data-cf]");if(cf){chatFilter=cf.dataset.cf;renderChats();return}
  const r=e.target.closest(".row");if(!r)return;
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
function closeAll(){overlay.classList.remove("show");menu.classList.remove("show");modal.classList.remove("show");overlay.style.background="";$("#msheet").classList.remove("show")}
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
function qrSVG(text){const q=qrcode(0,"M");q.addData(text);q.make();return q.createSvgTag({cellSize:5,margin:2,scalable:true})}
async function scanQR(){
  if(!("BarcodeDetector" in window)){toast("Telefonunun kamerasıyla QR'ı okut, açılan bağlantı arkadaş ekler",4000);return}
  let st;try{st=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})}catch(e){toast("Kameraya izin verilmedi");return}
  const det=new BarcodeDetector({formats:["qr_code"]});
  openInfoModal("📷 QR okut",`<video id="qrV" playsinline autoplay muted style="width:100%;border-radius:12px;background:#000"></video><p class="isub">Arkadaşının TR QR kodunu kameraya göster.</p>`);
  const v=$("#qrV");v.srcObject=st;let on=true;const stop=()=>{on=false;st.getTracks().forEach(t=>t.stop())};$("#eClose").addEventListener("click",stop,{once:true});
  const tick=async()=>{if(!on)return;try{const r=await det.detect(v);const val=r[0]&&r[0].rawValue;if(val){const m=val.match(/[?&]add=(\d{6})/);if(m){stop();closeE();addById(m[1]);return}}}catch(e){}setTimeout(tick,350)};setTimeout(tick,600)}
function showMyId(prefix=""){
  const c=users[me]?.code;
  if(c){openInfoModal("Benim TR ID'm",`${prefix}<div class="idbox">${esc(fmtCode(c))}</div>${users[me]?.un?`<div style="text-align:center;font-weight:700;color:var(--brand)">@${esc(users[me].un)}</div>`:""}<div class="qrbox">${qrSVG(location.origin+"/?add="+c)}</div><p class="isub" style="text-align:center">Arkadaşın bu QR'ı okutunca sana istek gönderir.</p>
    <div class="row2"><button id="qrCopy" style="background:var(--brand)">ID'yi kopyala</button><button id="qrScan" style="background:#0E7C3A">📷 QR okut</button></div><div class="row2"><button id="unSet" style="background:#555">${users[me]?.un?"Kullanıcı adını değiştir":"Kullanıcı adı al (@)"}</button></div>`);
    $("#qrCopy").onclick=async()=>{try{await navigator.clipboard.writeText(c);toast("ID kopyalandı")}catch(e){toast("Kopyalanamadı")}};
    $("#qrScan").onclick=()=>{closeE();scanQR()};$("#unSet").onclick=()=>{closeE();askUsername()};return}
  openModal({title:"Benim TR ID'm",input:false,ok:"Kopyala",cancelText:"Kapat",
    text:`${prefix}<div class="idbox">${esc(fmtCode(c)||"…")}</div>Bu numarayı arkadaşına ver. O “ID ile arkadaş ekle”den sana istek gönderir, sen kabul edince yazışabilirsiniz.`},
    async()=>{try{await navigator.clipboard.writeText(c);toast("ID kopyalandı")}catch(e){toast("Kopyalanamadı — numarayı elle yaz")}});
}
function askUsername(){
  openModal({title:"Kullanıcı adı",text:"3–20 karakter: küçük harf, rakam ve alt çizgi. Arkadaşların seni @adın ile bulabilir.",placeholder:"örn. harun_34",value:users[me]?.un||"",ok:"Kaydet"},async v=>{
    const un=String(v||"").trim().toLowerCase().replace(/^@/,"").replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ö/g,"o").replace(/ç/g,"c");
    if(!/^[a-z0-9_]{3,20}$/.test(un)){toast("Geçersiz kullanıcı adı",3000);return}if(hasBad(un)){toast("Uygunsuz kelime içeriyor");return}
    if(un===users[me]?.un)return;
    try{const ex=await getDoc(doc(fs,"usernames",un));if(ex.exists()){toast("Bu kullanıcı adı alınmış");return}
      await setDoc(doc(fs,"usernames",un),{uid:me});const old=users[me]?.un;if(old)deleteDoc(doc(fs,"usernames",old)).catch(()=>{});
      await saveMe({un});toast("Kullanıcı adın: @"+un)}catch(e){toast("Kaydedilemedi, başka bir ad dene")}})}
async function addByName(un){un=un.toLowerCase().replace(/^@/,"");let uid=null;try{const s=await getDoc(doc(fs,"usernames",un));if(s.exists())uid=s.data().uid}catch(e){}
  if(!uid||uid===me){toast(uid?"Bu sensin 🙂":"Bu kullanıcı adıyla kimse bulunamadı");return}
  watchUser(uid);try{const u=await getDoc(doc(fs,"users",uid));if(u.exists())users[uid]=cleanUser(u.data())}catch(e){}
  await saveContact(uid);openChat(uid);if(!isFriend(uid))await sendRequest(uid)}
function askAdd(){openModal({title:"Arkadaş ekle",text:"Arkadaşının 6 haneli TR ID'sini ya da @kullanıcı adını yaz. Ona arkadaşlık isteği gidecek; kabul edince yazışabilirsiniz.",placeholder:"örn. 482 913",ok:"İstek gönder"},addById)}
menu.onclick=e=>{const a=e.target.dataset.act;if(!a)return;closeAll();
  if(a==="myid")showMyId();
  if(a==="add")askAdd();
  if(a==="friends")openFriends();
  if(a==="views")openViews();
  if(a==="delacct")askDeleteAccount();
  if(a==="starred")openStarred();
  if(a==="settings")openSettings();
  if(a==="lock")openLockSettings();
  if(a==="install"){if(installEvt){installEvt.prompt();installEvt=null}else toast("Tarayıcı menüsünden “Uygulamayı yükle / Ana ekrana ekle” seçeneğini kullan",4000)}
  if(a==="notes")openNotes();
  if(a==="broadcast")openBroadcast();
  if(a==="feedback")openFeedback();
  if(a==="sound"){const m=localStorage.getItem("tr-mute")==="1";localStorage.setItem("tr-mute",m?"0":"1");toast(m?"🔊 Sesler açıldı":"🔇 Sesler kapatıldı");if(m)sfx("coin")}
  if(a==="privacy2")openPrivacy();
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
function cleanUser(x){return{nick:typeof x.nick==="string"?cleanText(x.nick.slice(0,62)):"",first:typeof x.first==="string"?cleanText(x.first.slice(0,30)):"",last:typeof x.last==="string"?cleanText(x.last.slice(0,30)):"",code:/^\d{6}$/.test(x.code)?x.code:"",pub:validPub(x.pub)?{x:x.pub.x,y:x.pub.y}:null,joined:+x.joined||0,av:+x.av||0,bio:typeof x.bio==="string"?cleanText(x.bio.slice(0,140)):"",un:typeof x.un==="string"&&/^[a-z0-9_]{3,20}$/.test(x.un)?x.un:""}}
function cleanGroup(x){if(!x||!Array.isArray(x.members))return null;return{name:typeof x.name==="string"?cleanText(x.name.slice(0,50)):"Grup",members:x.members.filter(u=>typeof u==="string").slice(0,MAX_GROUP),admins:Array.isArray(x.admins)?x.admins.filter(u=>typeof u==="string"):[],createdBy:String(x.createdBy||""),at:+x.at||0,adminOnly:!!x.adminOnly,inv:typeof x.inv==="string"&&/^[A-Za-z0-9]{8,32}$/.test(x.inv)?x.inv:""}}
async function claimCode(){
  for(let i=0;i<10;i++){
    const c=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
    try{await setDoc(doc(fs,"codes",c),{uid:me});return c}catch(e){}
  }
  throw new Error("code");
}
async function saveMe(patch){
  const prev=users[me];
  const next={nick:prev?.nick||"",first:prev?.first||"",last:prev?.last||"",code:prev?.code||"",pub:prev?.pub||myPub,joined:prev?.joined||Date.now(),av:prev?.av||0,bio:prev?.bio||"",un:prev?.un||"",...patch};
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
  $("#pFirst").value=f||"";$("#pLast").value=l||"";$("#pBio").value=u.bio||"";
  pAvNew=null;$("#pAvPrev").innerHTML=avHTML(me,{size:72});$("#pAvDel").style.display=u.av?"":"none";$("#pPhone").value=myPhone?fmtPhone(myPhone):"";
  $("#pErr").textContent="";$("#pCancel").style.display=first?"none":"";
  $("#pOk").textContent=first?"Başla":"Kaydet";
  $("#pTermsRow").style.display=first?"":"none";$("#pTerms").checked=false;
  $("#pRefRow").style.display=first?"":"none";{let rc="";try{rc=localStorage.getItem("tr_ref")||""}catch(e){}$("#pRef").value=rc?fmtCode(rc):""}
  setTimeout(()=>$(!$("#pFirst").value?"#pFirst":"#pPhone").focus(),60);
}
function closeProfile(){$("#pmodal").classList.remove("show");overlay.classList.remove("show");profileLocked=false}
$("#pCancel").onclick=closeProfile;
$("#pAvPick").onclick=()=>$("#pAvFile").click();
$("#pAvFile").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  if(!/^image\//.test(f.type)){toast("Bir fotoğraf seç");return}
  try{pAvNew=await shrinkImage(f);$("#pAvPrev").innerHTML=`<div class="av" style="width:72px;height:72px;background-image:url(${pAvNew})"></div>`;$("#pAvDel").style.display=""}catch(err){toast("Fotoğraf açılamadı")}};
$("#pAvDel").onclick=()=>{pAvNew="";$("#pAvPrev").innerHTML=`<div class="av" style="width:72px;height:72px;background:${colorOf(me)}">${esc(initials(users[me]?.nick||"Ben"))}</div>`;$("#pAvDel").style.display="none"};
["#pFirst","#pLast","#pPhone"].forEach((id,i,arr)=>$(id).onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();i<arr.length-1?$(arr[i+1]).focus():$("#pOk").click()}});
$("#pOk").onclick=async()=>{
  const f=cap($("#pFirst").value).slice(0,30),l=cap($("#pLast").value).slice(0,30),ph=normPhone($("#pPhone").value);
  if(!f){$("#pErr").textContent="Adını yaz";$("#pFirst").focus();return}
  if(!l){$("#pErr").textContent="Soyadını yaz";$("#pLast").focus();return}
  if(!ph){$("#pErr").textContent="Geçerli bir telefon numarası yaz (örn. 0532 123 45 67)";$("#pPhone").focus();return}
  if(hasBad(f)||hasBad(l)){$("#pErr").textContent="Ad ve soyadında uygunsuz kelime olamaz";return}
  const bio=$("#pBio").value.replace(/\s+/g," ").trim().slice(0,140);
  if(hasBad(bio)){$("#pErr").textContent="Hakkında yazısında uygunsuz kelime var";return}
  if(pFirstTime&&!$("#pTerms").checked){$("#pErr").textContent="Devam etmek için kullanım koşullarını ve gizlilik politikasını kabul et";return}
  $("#pOk").disabled=true;$("#pErr").textContent="";
  let ok=true;
  try{
    if(ph!==myPhone){const old=myPhone;await setDoc(privRef(),{phone:ph},{merge:true});myPhone=ph;await syncPhone(old)}
    const patch={first:f,last:l,nick:f+" "+l,pub:myPub,bio};
    if(pAvNew!==null)patch.av=await saveAvatar(pAvNew);
    if(!/^\d{6}$/.test(users[me]?.code||""))patch.code=await claimCode();
    ok=await saveMe(patch);
  }catch(e){ok=false}
  $("#pOk").disabled=false;
  if(!ok){$("#pErr").textContent="Kaydedilemedi, internetini kontrol edip tekrar dene";return}
  closeProfile();updateIdLabel();
  if(pFirstTime){const rc=$("#pRef").value.replace(/\D/g,"");if(rc.length===6&&rc!==users[me]?.code)applyRef(rc,false);
    showMyId(`<b>Hoş geldin ${esc(f)}!</b> Bu senin ID'n:<br><br>`)}
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
$("#msgInput").addEventListener("input",()=>{updateSendIcon();typing()});
$("#composer").onsubmit=async e=>{e.preventDefault();
  const v=$("#msgInput").value.trim();if(!cur||!me)return;
  if(!v){startRec();return}
  $("#msgInput").value="";updateSendIcon();$("#emojis").classList.remove("show");
  const content={t:"text",text:v.slice(0,2000)};
  if(replyTo){content.r=replyTo;replyTo=null;renderReplyBar()}
  let men=[];if(isGroupConv(cur)){const g=groups[gidOf(cur)];if(g)men=g.members.filter(u=>u!==me&&users[u]&&new RegExp("@"+(users[u].first||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(\\b|\\s|$)","iu").test(v))}
  const ok=await sendContent(cur,content,{men});
  try{const d=JSON.parse(localStorage.getItem("tr-drafts")||"{}");delete d[cur];localStorage.setItem("tr-drafts",JSON.stringify(d))}catch(e){}
  if(!ok&&!$("#msgInput").value){$("#msgInput").value=v;updateSendIcon()}
  $("#msgInput").focus();
};

/* ---------- fotoğraf ---------- */
$("#photoBtn").onclick=()=>$("#photoInput").click();
const fmtSize=n=>n>1048576?(n/1048576).toFixed(1).replace(".",",")+" MB":Math.max(1,Math.round(n/1024))+" KB";
$("#attBtn").onclick=()=>{if(!cur)return;$("#msheet").innerHTML=`<button data-att="album">🖼️ Fotoğraflar (10'a kadar)</button><button data-att="once">① Tek seferlik fotoğraf</button><button data-att="file">📄 Belge</button><button data-att="loc">📍 Konum</button><button data-att="vnote">🎥 Yuvarlak video mesaj</button><button data-att="stk">🧿 TR çıkartması</button><button data-att="card">💌 Tebrik kartı</button><button data-att="list">📝 Ortak liste</button>${isGroupConv(cur)?'<button data-att="poll">📊 Anket</button><button data-att="event">📅 Etkinlik</button>':""}`;
  sheetFor=null;$("#msheet").dataset.conv="";overlay.classList.add("show");$("#msheet").classList.add("show")};
$("#msheet").addEventListener("click",e=>{const b=e.target.closest("[data-att]");if(!b)return;e.stopPropagation();closeSheet();const a=b.dataset.att,conv=cur;
  if(a==="album")$("#photoInput").click();
  if(a==="once"){window.__onceNext=true;$("#photoInput").click()}
  if(a==="file")$("#fileInput").click();
  if(a==="poll")openPollMaker(conv);if(a==="event")openEventMaker(conv);
  if(a==="loc"){if(!navigator.geolocation){toast("Konum desteklenmiyor");return}toast("Konum alınıyor…",1500);
    navigator.geolocation.getCurrentPosition(p=>{openModal({title:"Konumu gönder",text:"Şu anki konumun bu sohbete gönderilsin mi?",input:false,ok:"Gönder"},()=>sendContent(conv,{t:"loc",lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6),acc:Math.round(p.coords.accuracy||0)}))},()=>toast("Konum alınamadı, izin vermen gerekiyor",3000),{enableHighAccuracy:true,timeout:15000})}
  if(a==="vnote")recordVideoNote(conv);
  if(a==="stk")openStickers(conv);
  if(a==="list")openInfoModal("📝 Ortak liste",`<input id="lsT" maxlength="80" placeholder="Başlık (ör. Pazar alışverişi)"><textarea id="lsI" rows="6" maxlength="2000" style="width:100%" placeholder="Her satıra bir madde"></textarea><div class="row2"><button id="lsGo" style="background:var(--brand)">Gönder</button></div>`),setTimeout(()=>{const g=$("#lsGo");if(g)g.onclick=()=>{const items=$("#lsI").value.split("\n").map(x=>x.trim()).filter(Boolean).slice(0,30);if(!items.length){toast("Madde yaz");return}if(hasBad($("#lsT").value+" "+items.join(" "))){toast("Uygunsuz kelime var");return}closeE();sendContent(conv,{t:"list",title:$("#lsT").value.trim()||"Liste",items})}},50);if(a==="card")openCards(conv);
},true);
$("#fileInput").onchange=async e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(!f||!cur)return;
  if(f.size>CHUNK*16){toast("Belge en fazla 9 MB olabilir",3000);return}const conv=cur;
  openModal({title:"Belge gönder",text:`${esc(f.name)} (${fmtSize(f.size)}) gönderilsin mi?`,input:false,ok:"Gönder"},async()=>{toast("Gönderiliyor…",1500);
    await sendContent(conv,{t:"file",name:f.name.slice(0,120)},{blob:f,mime:f.type||"application/octet-stream",meta:{name:f.name.slice(0,120)}})})};
async function recordVideoNote(conv){let st;try{st=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:480},height:{ideal:480}},audio:true})}catch(e){toast("Kamera/mikrofon izni gerekli");return}
  openInfoModal("🎥 Yuvarlak video",`<video id="vnPrev" class="vnote big" playsinline autoplay muted></video><div class="isub" id="vnT" style="text-align:center">En fazla 30 saniye</div><div class="row2"><button id="vnGo" style="background:var(--brand)">● Kaydı başlat</button></div>`);
  $("#vnPrev").srcObject=st;let rec=null,chunks=[],t0=0,timer=0,done=false;const stop=()=>{st.getTracks().forEach(t=>t.stop());clearInterval(timer)};
  $("#eClose").addEventListener("click",()=>{done=true;if(rec&&rec.state!=="inactive")rec.stop();stop()},{once:true});
  $("#vnGo").onclick=()=>{if(rec&&rec.state==="recording"){rec.stop();return}
    const mime=["video/mp4","video/webm;codecs=vp8,opus","video/webm"].find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported(x))||"";
    try{rec=new MediaRecorder(st,mime?{mimeType:mime,videoBitsPerSecond:400000}:{})}catch(e){toast("Bu cihazda video kaydı desteklenmiyor");return}
    rec.ondataavailable=ev=>{if(ev.data&&ev.data.size)chunks.push(ev.data)};
    rec.onstop=async()=>{stop();if(done)return;const blob=new Blob(chunks,{type:rec.mimeType||"video/webm"});closeE();
      if(blob.size>CHUNK*8){toast("Video çok büyük");return}await sendContent(conv,{t:"vnote"},{blob,mime:blob.type,meta:{dur:Math.round((Date.now()-t0)/1000)}})};
    rec.start(500);t0=Date.now();$("#vnGo").textContent="■ Durdur ve gönder";
    timer=setInterval(()=>{const sec=Math.floor((Date.now()-t0)/1000);$("#vnT").textContent=sec+" / 30 sn";if(sec>=30&&rec.state==="recording")rec.stop()},250)}}
async function deviceTest(){let st;try{st=await navigator.mediaDevices.getUserMedia({video:true,audio:true})}catch(e){toast("Kamera/mikrofon izni verilmedi",3000);return}
  openInfoModal("🎙️ Cihaz testi",`<video id="dtV" playsinline autoplay muted style="width:100%;border-radius:12px;background:#000;transform:scaleX(-1)"></video><div class="fl">Mikrofon seviyesi</div><div class="meter"><i id="dtM"></i></div><p class="isub">Konuşunca çubuk hareket ediyorsa mikrofonun çalışıyor.</p>`);
  $("#dtV").srcObject=st;const ac=new (window.AudioContext||window.webkitAudioContext)(),an=ac.createAnalyser();ac.createMediaStreamSource(st).connect(an);const buf=new Uint8Array(an.fftSize);let on=true;
  const loop=()=>{if(!on)return;an.getByteTimeDomainData(buf);let m=0;for(const v of buf)m=Math.max(m,Math.abs(v-128));const el=$("#dtM");if(el)el.style.width=Math.min(100,m*1.6)+"%";requestAnimationFrame(loop)};loop();
  $("#eClose").addEventListener("click",()=>{on=false;st.getTracks().forEach(t=>t.stop());ac.close().catch(()=>{})},{once:true})}
// uzun basınca: tek seferlik fotoğraf
{let t=null;$("#photoBtn").addEventListener("pointerdown",()=>{t=setTimeout(()=>{t=null;window.__onceNext=true;toast("① Tek seferlik fotoğraf: bir kez açılabilir",2500);$("#photoInput").click()},550)});["pointerup","pointerleave","pointercancel"].forEach(ev=>$("#photoBtn").addEventListener(ev,()=>{if(t){clearTimeout(t);t=null}}))}
$("#photoInput").onchange=async e=>{
  const fl=[...(e.target.files||[])].slice(0,10);e.target.value="";if(!fl.length||!cur)return;
  if(fl.length>1){const conv=cur;toast(`${fl.length} fotoğraf gönderiliyor…`,2000);for(const f of fl){if(!f.type.startsWith("image/"))continue;try{const {blob,w,h}=await compressImage(f,SET.hq?2600:1600,SET.hq?0.92:0.82);if(blob.size<=CHUNK*8)await sendContent(conv,{t:"img"},{blob,mime:blob.type,meta:{w,h}})}catch(err){}}return}
  const f=fl[0];
  if(!f.type.startsWith("image/")){toast("Lütfen bir fotoğraf seç");return}
  const conv=cur;
  try{
    toast("Fotoğraf hazırlanıyor…",1500);
    const {blob,w,h}=await compressImage(f,SET.hq?2600:1600,SET.hq?0.92:0.82);
    if(blob.size>CHUNK*8){toast("Fotoğraf çok büyük");return}
    const once=!!window.__onceNext;window.__onceNext=false;
    await sendContent(conv,once?{t:"img",once:true}:{t:"img"},{blob,mime:blob.type,meta:{w,h}});
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
  rec={mr,stream,chunks,conv,start:Date.now(),send:false,timer:null,tx:""};
  // isteğe bağlı: konuşmayı yazıya çevir (tarayıcının konuşma tanıması; ayarlardan açılır)
  {const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(SET.stt&&SR){try{const r0=rec,sr=new SR();sr.lang="tr-TR";sr.continuous=true;sr.interimResults=false;
    sr.onresult=ev=>{for(let i=ev.resultIndex;i<ev.results.length;i++)if(ev.results[i].isFinal)r0.tx=(r0.tx+" "+ev.results[i][0].transcript).trim().slice(0,1000)};sr.onerror=()=>{};sr.start();r0.sr=sr}catch(e){}}}
  mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  mr.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    const r=rec;rec=null;clearInterval(r.timer);try{r.sr&&r.sr.stop()}catch(e){}if(r.sr)await new Promise(ok=>setTimeout(ok,700));
    $("#recbar").classList.remove("show");$("#composer").style.display="";
    if(!r.send)return;
    const dur=Math.round((Date.now()-r.start)/1000);
    if(dur<1){toast("Kayıt çok kısa");return}
    const type=(mr.mimeType||mime||"audio/webm").split(";")[0];
    const blob=new Blob(chunks,{type});
    if(r.send==="preview"){const u=URL.createObjectURL(blob);openInfoModal("🎤 Sesli mesaj",`<audio controls src="${u}" style="width:100%"></audio><div class="row2"><button id="vpSend" style="background:var(--brand)">Gönder</button><button id="vpDel" style="background:#555">Sil</button></div>`);
      $("#vpSend").onclick=()=>{closeE();sendContent(r.conv,{t:"voice",dur,...(r.tx?{tx:r.tx}:{})},{blob,mime:type})};$("#vpDel").onclick=()=>{closeE();URL.revokeObjectURL(u)};return}
    await sendContent(r.conv,{t:"voice",dur,...(r.tx?{tx:r.tx}:{})},{blob,mime:type});
  };
  mr.start(1000);
  $("#composer").style.display="none";$("#recbar").classList.add("show");$("#recTime").textContent="0:00";
  rec.timer=setInterval(()=>{const s=(Date.now()-rec.start)/1000;$("#recTime").textContent=fmtDur(s);if(s>=MAX_VOICE_SEC)stopRec(true)},250);
}
function stopRec(send){if(!rec)return;rec.send=send;try{rec.mr.stop()}catch(e){}}
$("#recCancel").onclick=()=>stopRec(false);
$("#recSend").onclick=()=>stopRec(true);
$("#recPrev").onclick=()=>stopRec("preview");

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
  unsubs.push(onSnapshot(doc(fs,"badges",uid),s=>{const bd=s.exists()?s.data():{};
    {const prev=bdg[uid];const ach=Array.isArray(bd.ach)?bd.ach.filter(x=>typeof x==="string"):[];const gifts=bd.gifts&&typeof bd.gifts==="object"?bd.gifts:{};
      if(uid===me&&prev){const fresh=ach.filter(a=>!prev.ach.includes(a));fresh.forEach((a,i)=>setTimeout(()=>{const A=(catalog?.ach||[]).find(x=>x.id===a);if(A){toast(`${A.icon} Başarım: ${A.name} · +${fmtCoin(A.prize)} jeton`,4000);sfx("win")}},i*4200))}
      bdg[uid]={ach,gifts}}
    const v=+bd.vipUntil||0;if((vipU[uid]||0)!==v){vipU[uid]=v;renderAll()}},()=>{}));
  unsubs.push(onSnapshot(doc(fs,"statuses",uid),s=>{const x=s.exists()?s.data():null;if(x&&x.text)statuses[uid]={text:cleanText(String(x.text).slice(0,300)),at:+x.at||0,bg:/^#[0-9a-fA-F]{6}$/.test(x.bg)?x.bg:"#111"};else delete statuses[uid];renderStatus()},()=>{}));
}

onAuthStateChanged(auth,async u=>{
  stopAll();
  if(!u){me=null;ready=false;$("#login").classList.add("show");$("#splash").classList.remove("show");return}
  meUser=u;me=u.uid;
  $("#login").classList.remove("show");$("#splash").classList.add("show");
  try{await initKeys()}catch(e){$("#splash").classList.remove("show");banner("Bağlantı kurulamadı. İnternetini kontrol edip sayfayı yenile.");return}
  ready=true;$("#splash").classList.remove("show");lockApp();
  try{const s=await getDoc(doc(fs,"users",me));if(s.exists())users[me]=cleanUser(s.data())}catch(e){}
  const mineU=users[me];
  if(!mineU||!mineU.first||!mineU.last||!myPhone||!mineU.code)askProfile(true);
  else if(!mineU.pub||mineU.pub.x!==myPub.x||mineU.pub.y!==myPub.y)saveMe({pub:myPub});
  updateIdLabel();renderAll();
  syncPhone().catch(()=>{});
  setupPush(false).catch(()=>{});
  initWallet();

  watchUser(me);
  unsubs.push(onSnapshot(doc(fs,"private",me,"data","prefs"),s=>{const x=s.exists()?s.data():{};
    prefs={mute:x.mute&&typeof x.mute==="object"?x.mute:{},arch:Array.isArray(x.arch)?x.arch:[],pin:Array.isArray(x.pin)?x.pin:[],fav:Array.isArray(x.fav)?x.fav:[],star:Array.isArray(x.star)?x.star:[],pinMsg:x.pinMsg&&typeof x.pinMsg==="object"?x.pinMsg:{},noRead:!!x.noRead,vis:["all","friends","none"].includes(x.vis)?x.vis:"all",oncev:Array.isArray(x.oncev)?x.oncev.slice(-300):[]};
    renderAll();beat(true)},()=>{}));
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
    raw=s.docs.map(d=>{const x=d.data()||{};return{id:d.id,from:String(x.from||""),to:typeof x.to==="string"?x.to:"",gid:typeof x.gid==="string"?x.gid:"",keys:x.keys&&typeof x.keys==="object"?x.keys:null,at:+x.at||0,iv:String(x.iv||""),ct:String(x.ct||""),ed:+x.ed||0,rx:x.rx&&typeof x.rx==="object"?x.rx:null,exp:+x.exp||0,men:Array.isArray(x.men)?x.men:null,pv:x.pv&&typeof x.pv==="object"?x.pv:null,ck:x.ck&&typeof x.ck==="object"?x.ck:null}})
      .filter(m=>m.iv&&m.ct&&m.from&&(m.gid||(m.to&&m.from!==m.to&&(m.from===me||m.to===me))));
    raw.forEach(m=>{watchUser(m.from);if(m.to)watchUser(m.to);if(ctSeen[m.id]&&ctSeen[m.id]!==m.ct)delete plain[m.id];ctSeen[m.id]=m.ct});
    pending=pending.filter(p=>!raw.find(m=>m.id===p.id));notifyIncoming();
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
    s.docs.forEach(d=>{const x=d.data();if(x&&typeof x.at==="number"){if(d.id.startsWith(me+"_"))reads[d.id]=Math.max(reads[d.id]||0,x.at);else{reads[d.id]=x.at;readsHidden[d.id]=!!x.h}}});
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
  $("#csCam").style.display=c.video?"":"none";$("#csFlip").style.display=c.video?"":"none";$("#csScreen").style.display=c.video&&navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia?"":"none";$("#csPip").style.display=c.video&&document.pictureInPictureEnabled?"":"none";
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
$("#csScreen").onclick=async()=>{const c=call;if(!c||!c.video||!c.pc)return;const sender=c.pc.getSenders().find(s=>s.track&&s.track.kind==="video");if(!sender)return;
  if(c.sharing){const cam=c.stream.getVideoTracks()[0];if(cam)await sender.replaceTrack(cam);c.sharing.getTracks().forEach(t=>t.stop());c.sharing=null;toast("Ekran paylaşımı bitti");return}
  try{const ds=await navigator.mediaDevices.getDisplayMedia({video:true});const tr=ds.getVideoTracks()[0];await sender.replaceTrack(tr);c.sharing=ds;toast("🖥️ Ekranın paylaşılıyor");tr.onended=async()=>{if(call&&call.sharing){const cam=call.stream.getVideoTracks()[0];if(cam)await sender.replaceTrack(cam);call.sharing=null}}}catch(e){toast("Ekran paylaşılamadı")}};
$("#csPip").onclick=async()=>{const v=$("#remoteVideo");try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(v&&document.pictureInPictureEnabled)await v.requestPictureInPicture();else toast("Küçük pencere bu cihazda desteklenmiyor")}catch(e){toast("Küçük pencere açılamadı")}};
$("#csDeclineMsg").onclick=()=>{const c=call;if(!c)return;const peer=c.peer;
  openInfoModal("💬 Mesajla reddet",["Şu an konuşamıyorum, sonra ararım.","Toplantıdayım, mesaj atar mısın?","Yoldayım, birazdan dönerim.","Müsait değilim 🙏"].map((t,i)=>`<div class="pk" data-q="${i}" style="cursor:pointer">${esc(t)}</div>`).join(""));
  const Q=["Şu an konuşamıyorum, sonra ararım.","Toplantıdayım, mesaj atar mısın?","Yoldayım, birazdan dönerim.","Müsait değilim 🙏"];
  $("#eBody").onclick=async e=>{const r=e.target.closest("[data-q]");if(!r)return;closeE();await declineCall();if(peer)sendContent(peer,{t:"text",text:Q[+r.dataset.q]})}};
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
  try{const r=await callApi("/api/wallet",{action:"me"});catalog=r.wallet.catalog;applyWallet(r.wallet);
    if(r.vipCoins)setTimeout(()=>toast(`👑 VIP günlük jetonun yüklendi: +${fmtCoin(r.vipCoins)}`,4000),2500);
    if(r.back)setTimeout(()=>openInfoModal("💛 Seni özledik!",`<div style="text-align:center;font-size:15px"><div style="font-size:44px">🤗</div>Tekrar hoş geldin! Sana <b>${fmtCoin(r.back)}</b> jeton hediye ettik.</div>`),1200);
    if(r.welcomed)setTimeout(showTour,9000);
    if(!r.welcomed&&dailyAvailable())setTimeout(()=>{if(!document.querySelector(".modal.show"))openDaily()},1800);
    if(r.welcomed)setTimeout(()=>openInfoModal("🎁 Hoş geldin!",`<div style="text-align:center;font-size:15px;line-height:1.5"><div style="font-size:44px">🎉</div>Sana <b>${fmtCoin(100000)}</b> <span class="coin"></span> jeton hediye ettik.<br>Oyun sekmesinden harcayabilirsin.</div>`),1500)}catch(e){}
  unsubs.push(onSnapshot(doc(fs,"wallets",me),s=>{if(!s.exists())return;const x=s.data();const lv=levelFromXp(x.xp||0);applyWallet({...(wallet||{}),balance:x.balance||0,xp:x.xp||0,level:lv.level,levelCur:lv.cur,levelNext:lv.next,wins:x.wins||0,games:x.games||0,owned:x.owned,skin:x.skin,vipUntil:+x.vipUntil||0,adult:!!x.adult,ageSet:!!x.birthYear})},()=>{}));
  callApi("/api/admin",{action:"check"}).then(r=>{isAdminUser=!!(r&&r.admin);window.__isMod=!!(r&&r.mod);houseStats=r&&r.house;renderGamesTab()}).catch(()=>{});
}
function applyWallet(w){wallet=w;setTimeout(renderBell,0);setTimeout(weeklySummary,6000);setTimeout(dailyBanner,0);setTimeout(maybeAskRating,4000);if(w&&w.vipUntil!=null&&me)vipU[me]=Math.max(vipU[me]||0,+w.vipUntil||0);renderGamesTab();if(game)renderGame()}
function mySkin(kind){const def=kind==="table"?"yesil":kind==="tile"?"klasik":"ceviz";const id=wallet?.skin?.[kind]||def;if((id.startsWith("vip_")||id==="sedef")&&!isVipU(me))return def;return id}

/* ---------- sandık, destek, çark, görevler, oyun geçmişi ---------- */
const chestLeft=()=>wallet?(wallet.chestAt||0)+(wallet.chestEvery||4*3600e3)-Date.now():1;
const fmtWait=ms=>{const m=Math.max(1,Math.ceil(ms/60000));if(m>=1440)return Math.floor(m/1440)+" gün "+Math.floor(m%1440/60)+" sa";return m>=60?Math.floor(m/60)+" sa "+(m%60)+" dk":m+" dk"};
setInterval(()=>{renderBell();const l=document.querySelector(".chestlbl");if(l&&wallet){const x=chestLeft();l.textContent=x<=0?"Sandık hazır!":"Sandık · "+fmtWait(x)}},30000);
async function claimGift(kind){
  if(kind==="chest"&&chestLeft()>0){toast("Sandık "+fmtWait(chestLeft())+" sonra açılır");return}
  try{const r=await callApi("/api/wallet",{action:kind});applyWallet({...wallet,...r.wallet});sfx("coin");toast(`${kind==="chest"?"🧰":"🆘"} +${fmtCoin(r.gift.amount)} jeton`,3000)}
  catch(e){toast(kind==="chest"?"Sandık henüz hazır değil":"Destek bugün alınmış ya da bakiyen yeterli")}
}
function openSpin(){
  const segs=catalog?.wheel||[1000,2000,3000,5000,10000,25000,50000,100000],n=segs.length,can=wallet.spinDay!==wallet.today;
  const cols=["#E30A17","#F2C200","#1E4FD8","#127A3A","#F07A12","#5B2A86","#0E7C8A","#111"];
  const sl=segs.map((v,i)=>{const a0=i/n*2*Math.PI-Math.PI/2,a1=(i+1)/n*2*Math.PI-Math.PI/2,am=(a0+a1)/2;
    return`<path d="M100 100 L${100+95*Math.cos(a0)} ${100+95*Math.sin(a0)} A95 95 0 0 1 ${100+95*Math.cos(a1)} ${100+95*Math.sin(a1)} Z" fill="${cols[i%cols.length]}"/><text x="${100+62*Math.cos(am)}" y="${100+62*Math.sin(am)}" fill="#fff" font-size="12" font-weight="800" text-anchor="middle" dominant-baseline="middle" transform="rotate(${am*180/Math.PI+90} ${100+62*Math.cos(am)} ${100+62*Math.sin(am)})">${fmtK(v)}</text>`}).join("");
  openInfoModal("🎡 Günlük çark",`<div class="wheelbox"><div class="wptr">▼</div><svg id="wheel" viewBox="0 0 200 200" width="260" height="260"><circle cx="100" cy="100" r="98" fill="#fff"/>${sl}<circle cx="100" cy="100" r="14" fill="#fff" stroke="#ddd"/></svg></div>
    <div class="row2"><button id="spinGo" ${can?"":"disabled"} style="background:${can?"var(--brand)":"#999"}">${can?"Çevir!":"Yarın tekrar çevirebilirsin"}</button></div>`);
  if(can)$("#spinGo").onclick=async()=>{$("#spinGo").disabled=true;
    let r;try{r=await callApi("/api/wallet",{action:"spin"})}catch(e){toast("Bugün zaten çevirdin");closeE();return}
    const per=360/n,target=360*6-(r.gift.idx*per+per/2);
    const w=$("#wheel");w.style.transition="transform 4s cubic-bezier(.17,.67,.2,1)";w.style.transform=`rotate(${target}deg)`;sfx("spin");
    setTimeout(()=>{applyWallet({...wallet,...r.wallet});sfx("win");$("#spinGo").textContent=`🎉 ${fmtCoin(r.gift.amount)} jeton kazandın!`},4100);
  };
}
function openTasks(){
  const ts=wallet.tasks||[];
  openInfoModal("✅ Günlük görevler",`<p class="isub">Görevler her gece yenilenir.</p>`+ts.map(t=>`<div class="pk"><div style="flex:1"><b style="font-size:15px">${esc(t.text)}</b><div class="tbar"><i style="width:${Math.min(100,100*t.prog[0]/t.prog[1])}%"></i></div><div class="isub">${Math.min(t.prog[0],t.prog[1])}/${t.prog[1]} · ödül ${fmtCoin(t.prize)} jeton</div></div><button class="pr ${t.claimed?"eq":t.done?"":"own"}" data-task="${t.id}" ${t.claimed||!t.done?"disabled":""}>${t.claimed?"Alındı":t.done?"Al":"Devam"}</button></div>`).join("")+`<p class="isub" style="margin-top:10px">🔥 Jetonlu masalarda üst üste 3 galibiyete ek ${fmtCoin(5000)} jeton! Şu anki serin: ${wallet.winStreak||0}</p>`);
  $("#eBody").onclick=async e=>{const b=e.target.closest("[data-task]");if(!b||b.disabled)return;b.disabled=true;
    try{const r=await callApi("/api/wallet",{action:"task",id:b.dataset.task});applyWallet({...wallet,...r.wallet});sfx("coin");toast(`+${fmtCoin(r.gift.amount)} jeton`);openTasks()}catch(err){toast("Alınamadı");b.disabled=false}};
}
async function loadHistory(){const s=await getDocs(query(collection(fs,"gh",me,"g"),orderBy("at","desc"),limit(100)));return s.docs.map(d=>d.data())}
async function openHistory(){
  openInfoModal("🕘 Oyun geçmişim",'<div class="isub">Yükleniyor…</div>');
  let rows=[];try{rows=await loadHistory()}catch(e){$("#eBody").innerHTML='<div class="isub">Yüklenemedi</div>';return}
  rows.forEach(r=>(r.opp||[]).forEach(watchUser));
  const w=rows.filter(r=>r.won).length,net=rows.reduce((a,r)=>a+(r.delta||0),0);
  $("#eBody").innerHTML=`<div class="pk" style="display:block"><b>Son ${rows.length} oyun</b><div class="isub">${w} galibiyet · ${rows.length-w-rows.filter(r=>r.draw).length} mağlubiyet · net ${net>=0?"+":""}${fmtCoin(net)} jeton</div></div>`+
    (rows.map(r=>`<div class="hist"><span>${gk(r.type)[0]} ${r.draw?"Berabere":r.won?"<b style='color:#0E7C3A'>Kazandın</b>":"Kaybettin"}${(r.opp||[]).length?" · "+r.opp.map(u=>esc(realName(u))).join(", "):" · bilgisayara karşı"}</span><span class="isub">${new Date(r.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><span class="d" style="color:${r.delta>0?"#0E7C3A":r.delta<0?"#E53935":"inherit"}">${r.delta>0?"+":""}${fmtCoin(r.delta||0)}</span></div>`).join("")||'<div class="empty">Henüz oyun oynamadın</div>');
}

/* ---------- ses ve titreşim ---------- */
let actx=null;
function sfx(kind){
  if(localStorage.getItem("tr-mute")==="1")return;
  try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime;
    const tone=(f,d,type="sine",v=.12,at=0)=>{const o=actx.createOscillator(),g=actx.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(v,t+at);g.gain.exponentialRampToValueAtTime(.001,t+at+d);o.connect(g);g.connect(actx.destination);o.start(t+at);o.stop(t+at+d)};
    if(kind==="tile")tone(520,.06,"square",.05);
    else if(kind==="turn"){tone(660,.12);tone(880,.16,"sine",.12,.12);try{SET.vib&&navigator.vibrate&&navigator.vibrate(60)}catch(e){}}
    else if(kind==="ball")tone(1200,.04,"triangle",.1);
    else if(kind==="coin"){tone(988,.08,"square",.06);tone(1319,.25,"square",.06,.08)}
    else if(kind==="win"){[523,659,784,1047].forEach((f,i)=>tone(f,.2,"triangle",.12,i*.12));try{SET.vib&&navigator.vibrate&&navigator.vibrate([80,60,120])}catch(e){}}
    else if(kind==="spin")for(let i=0;i<24;i++)tone(900,.02,"square",.03,i*.15*(1+i/30));
  }catch(e){}
}

/* ---------- günlük giriş hediyesi ---------- */
function dailyAvailable(){return !!wallet&&wallet.today&&wallet.lastDaily!==wallet.today}
function openDaily(){
  const cal=catalog?.login||[],can=dailyAvailable();
  const cont=wallet.lastDaily===wallet.yesterday||wallet.lastDaily===wallet.today;
  const done=cont?(wallet.streak||0)%30===0&&wallet.lastDaily!==wallet.today?0:(wallet.streak||0):0; // bugüne kadar alınan gün sayısı
  const nextDay=can?(cont?(done%30)+1:1):done;
  openInfoModal("🎁 Günlük giriş hediyesi",`<p class="isub">Her gün gir, hediyeni al. Bir gün kaçırırsan takvim 1. güne döner. 30. gün ${catalog?.loginVip||3} günlük VIP de hediye!</p>
    <div class="cal">${cal.map((v,i)=>{const d=i+1;const got=can?d<nextDay:d<=done;const now=can&&d===nextDay;return`<div class="cd ${got?"got":""} ${now?"now":""} ${d%7===0||d===30?"big":""}"><small>${d}. gün</small><b>${got?"✓":fmtK(v)}</b>${d===30?"<small>+VIP</small>":""}</div>`}).join("")}</div>
    <div class="row2" style="margin-top:10px"><button id="dClaim" ${can?"":"disabled"} style="background:${can?"var(--brand)":"#999"}">${can?`${nextDay}. günün hediyesini al · ${fmtCoin(cal[nextDay-1]||0)}`:"Bugünün hediyesini aldın · yarın gel"}</button></div>`);
  if(can)$("#dClaim").onclick=async()=>{$("#dClaim").disabled=true;
    try{const r=await callApi("/api/wallet",{action:"daily"});applyWallet({...r.wallet});if(r.wallet.vipUntil)vipU[me]=r.wallet.vipUntil;
      closeE();toast(`🎁 +${fmtCoin(r.daily.amount)} jeton${r.daily.vip?` ve ${r.daily.vip} gün VIP`:""}!`,3500);renderAll()}
    catch(e){toast(e.status===409?"Bugünün hediyesini zaten aldın":"Alınamadı, tekrar dene");closeE()}};
}
const fmtK=v=>v>=1000?(v/1000).toLocaleString("tr-TR",{maximumFractionDigits:1})+"B":String(v);

/* ---------- arkadaşını çağır ---------- */
function inviteLink(){return location.origin+"/?ref="+(users[me]?.code||"")}
function openInvite(){
  const code=users[me]?.code||"",bonus=catalog?.refBonus||100000;
  openInfoModal("👥 Arkadaşını çağır",`<div class="vipcard" style="background:linear-gradient(135deg,#0E7C3A,#14532D)"><div class="vt" style="color:#fff">Her arkadaşın için ${fmtCoin(bonus)} jeton</div><div class="vs">Arkadaşın TR'ye kaydolurken senin ID'ni yazsın. İlk oyununu bitirince hediyen hesabına yüklenir.</div></div>
    <div class="pk" style="display:block;text-align:center"><div class="isub">Senin TR ID'n</div><div style="font-size:28px;font-weight:800;letter-spacing:2px">${esc(fmtCode(code))}</div></div>
    <div class="row2"><button id="invShare" style="background:var(--brand)">Davet bağlantısını paylaş</button></div>
    <p class="isub" style="margin-top:8px">Şimdiye kadar ${fmtCoin(wallet?.refCount||0)} arkadaşın katıldı.</p>
    <div class="fl">🏆 Ayın davet şampiyonları <span class="isub">ilk 3'e ${(catalog?.refPrizes||[300000,200000,100000]).map(fmtCoin).join(" / ")} jeton</span></div><div id="refTop"><div class="isub">Yükleniyor…</div></div>
    ${wallet?.canRef?`<div class="fl" style="margin-top:12px">Seni davet eden biri var mı?</div><input id="refCode" inputmode="numeric" placeholder="Davet edenin TR ID'si"><div class="row2"><button id="refGo" style="background:#0E7C3A">Kaydet</button></div>`:""}`);
  {const mo=new Date(Date.now()+3*3600e3).toISOString().slice(0,7).replace("-","");getDocs(query(collection(fs,"lb_ref",mo,"u"),orderBy("n","desc"),limit(10))).then(s=>{const el=$("#refTop");if(!el)return;s.docs.forEach(d=>watchUser(d.id));
    setTimeout(()=>{if($("#refTop"))$("#refTop").innerHTML=s.empty?'<div class="isub">Bu ay henüz davet yok, ilk sen ol!</div>':s.docs.map((d,i)=>`<div class="lbrow ${d.id===me?"me":""}"><span class="rk">${i<3?["🥇","🥈","🥉"][i]:i+1}</span>${avHTML(d.id)}<span class="nm">${esc(d.id===me?"Sen":realName(d.id))}</span><span class="pt">${d.data().n||0} kişi</span></div>`).join("")},400)}).catch(()=>{const el=$("#refTop");if(el)el.innerHTML=""})}
  $("#invShare").onclick=async()=>{const url=inviteLink(),text=`TR'de bana katıl! Kaydolurken davet kodu olarak ${fmtCode(code)} yaz, birlikte Okey ve bilardo oynayalım: ${url}`;
    try{if(navigator.share){await navigator.share({title:"TR",text,url});return}}catch(e){return}
    try{await navigator.clipboard.writeText(text);toast("Davet mesajı kopyalandı")}catch(e){toast(url,5000)}};
  if($("#refGo"))$("#refGo").onclick=()=>applyRef($("#refCode").value,true);
}
async function applyRef(code,loud){
  code=String(code||"").replace(/\D/g,"");if(code.length!==6){if(loud)toast("6 haneli ID yaz");return}
  try{const r=await callApi("/api/wallet",{action:"ref",code});applyWallet({...r.wallet});try{localStorage.removeItem("tr_ref")}catch(e){}
    if(loud){closeE();toast("Kaydedildi. Davet eden arkadaşınla artık arkadaşsınız.",3500)}}
  catch(e){try{localStorage.removeItem("tr_ref")}catch(_){}if(loud)toast(e.status===404?"Bu ID ile kullanıcı yok":e.status===409?"Davet kodu sadece yeni hesaplarda kullanılabilir":"Kaydedilemedi")}
}
try{const rq=new URLSearchParams(location.search).get("ref");if(rq&&/^\d{6}$/.test(rq))localStorage.setItem("tr_ref",rq)}catch(e){}

/* ---------- jeton hareketlerim ---------- */
async function openLedger(){
  openInfoModal("📜 Jeton hareketlerim",'<div class="isub">Yükleniyor…</div>');
  let r;try{r=await callApi("/api/wallet",{action:"ledger"})}catch(e){$("#eBody").innerHTML='<div class="isub">Yüklenemedi</div>';return}
  $("#eBody").innerHTML=`<p class="isub">Son ${r.rows.length} hareket. Bir hareketi anlamadıysan menüden Destek'e yaz.</p>`+(r.rows.map(h=>`<div class="hist"><span>${esc(h.reason)}</span><span class="isub">${new Date(h.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><span class="d" style="color:${h.delta>0?"#0E7C3A":"#E53935"}">${h.delta>0?"+":""}${fmtCoin(h.delta)}</span></div>`).join("")||'<div class="isub">Hareket yok</div>');
}

/* ---------- herkese açık masalar ---------- */
let pubUnsub=null;
function openPublic(type){
  const [icon,name]=gk(type);
  openInfoModal(`${icon} ${name} · açık masalar`,`<div class="row2"><button id="pubQuick" style="background:var(--brand)">⚡ Hızlı otur</button><button id="pubNew" style="background:#0E7C3A">+ Masa kur</button></div>
    <p class="isub" style="margin:8px 0">Masa 20 saniye içinde dolmazsa boş yerlere bilgisayar oturur.</p><div id="pubList"><div class="isub">Yükleniyor…</div></div><div class="fl" style="margin-top:10px">👀 Oynanan masaları izle</div><div id="pubLive"><div class="isub">Yükleniyor…</div></div>`);
  getDocs(query(collection(fs,"games"),where("public","==",true),where("status","==","play"),limit(30))).then(s=>{const el=$("#pubLive");if(!el)return;
    const rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.type===type||(type==="okey"&&!g.type)).filter(g=>Date.now()-(g.updatedAt||0)<5*60e3).slice(0,10);
    rows.forEach(g=>g.seats.forEach(x=>x&&x.uid&&watchUser(x.uid)));
    el.innerHTML=rows.length?rows.map(g=>`<div class="pk pubrow" data-watch="${g.id}" style="cursor:pointer"><div style="flex:1"><b>${g.stake?`<span class="coin"></span> ${fmtCoin(g.stake)}`:"Ücretsiz"}</b><div class="isub">${g.seats.map(x=>x?esc(seatName(x)):"").filter(Boolean).join(", ")}</div></div><span>İzle ›</span></div>`).join(""):'<div class="isub">Şu an oynanan açık masa yok</div>'}).catch(()=>{const el=$("#pubLive");if(el)el.innerHTML=""});
  if(pubUnsub)pubUnsub();
  const q=query(collection(fs,"games"),where("public","==",true),where("status","==","lobby"),limit(60));
  let rows=[];
  pubUnsub=onSnapshot(q,s=>{
    if(!$("#pubList")){pubUnsub&&pubUnsub();pubUnsub=null;return}
    rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.type===type&&Date.now()-(g.at||0)<10*60e3&&g.seats.some(x=>!x)).sort((a,b)=>(a.stake-b.stake)||(b.at-a.at));
    rows.forEach(g=>g.seats.forEach(x=>x&&x.uid&&watchUser(x.uid)));
    $("#pubList").innerHTML=rows.length?rows.map(g=>{const n=g.seats.filter(Boolean).length;return`<div class="pk pubrow"><div style="flex:1"><b>${g.stake?`<span class="coin"></span> ${fmtCoin(g.stake)}`:"Ücretsiz"}</b><div class="isub">${g.seats.map(x=>x?esc(x.uid===me?"Sen":realName(x.uid)):"boş").join(" · ")}</div></div><button class="pr" data-pubjoin="${esc(g.id)}" data-stake="${g.stake||0}">${n}/${g.seats.length} · Otur</button></div>`}).join(""):`<div class="empty">Şu an açık ${name} masası yok. İlk masayı sen kur!</div>`;
  },()=>{if($("#pubList"))$("#pubList").innerHTML='<div class="isub">Masalar yüklenemedi</div>'});
  const join=async(id,stake)=>{
    if(stake&&!wallet?.adult){closeE();if(wallet?.ageSet)toast("Jetonlu masalar 18 yaş üstüne açık",3000);else askAge(()=>openPublic(type));return}
    if(stake>(wallet?.balance||0)){toast("Bakiyen yetmiyor");return}
    closeE();pubUnsub&&pubUnsub();pubUnsub=null;
    const r=await gameApi({action:"join",id},type);
    if(r&&r.error){toast("Masaya oturulamadı, dolmuş olabilir");return}
    openGame(id);
  };
  const create=stake=>gameApi({action:"create",type,public:true,stake,turnSec:window.__turnSec||0,canak:!!window.__canak},type).then(r=>{if(!r||!r.id){toast("Masa kurulamadı");return}openGame(r.id)});
  $("#eBody").onclick=e=>{const w=e.target.closest("[data-watch]");if(w){closeE();pubUnsub&&pubUnsub();pubUnsub=null;openGame(w.dataset.watch);return}const b=e.target.closest("[data-pubjoin]");if(b)join(b.dataset.pubjoin,+b.dataset.stake)};
  $("#pubNew").onclick=()=>{pubUnsub&&pubUnsub();pubUnsub=null;pickStake(stake=>create(stake),type)};
  $("#pubQuick").onclick=()=>{pubUnsub&&pubUnsub();pubUnsub=null;pickStake(stake=>{
    const lv=wallet?.level||1;const m=rows.filter(g=>(g.stake||0)===stake&&!g.seats.some(x=>x&&x.uid===me)).sort((a,b)=>Math.abs((a.hostLvl||lv)-lv)-Math.abs((b.hostLvl||lv)-lv))[0];
    if(m)join(m.id,stake);else create(stake);
  },type)};
}

/* ---------- VIP ---------- */
function openVip(){
  const v=catalog?.vip||{priceTL:499,days:30,coins:300000,daily:10000},on=isVipU(me);
  const perks=[["🪙",`${fmtCoin(v.coins)} jeton hediye`,`${v.days} gün boyunca her gün ${fmtCoin(v.daily)} jeton hesabına yüklenir`],["👑","Adının yanında VIP tacı","Sohbetlerde, masada ve sıralamada herkes görür"],["🎨","VIP masa ve ıstaka desenleri","Kraliyet moru, beyaz mermer, altın işlemeli, sedef, elmas"],["👀","Profilimi kimler gördü","Son 30 günde profiline bakanların listesi"]];
  openInfoModal("👑 TR VIP",`<div class="vipcard"><div class="vt">${on?"VIP üyeliğin aktif":"VIP ol, farkını göster"}</div><div class="vs">${on?esc(new Date(vipU[me]).toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"}))+" tarihine kadar"+(wallet?.vipLeft?` · ${wallet.vipLeft} günlük jeton kaldı`:""):v.days+" gün · "+v.priceTL+" TL"}</div></div>
    ${perks.map(p=>`<div class="pk"><span style="font-size:26px">${p[0]}</span><div><b style="font-size:15px">${p[1]}</b><div class="isub">${p[2]}</div></div></div>`).join("")}
    <div class="row2" style="margin-top:10px"><button id="vipBuy" class="vipbuy">${on?"30 gün uzat":"VIP ol"} · ${v.priceTL} TL</button></div>
    <p class="isub" style="text-align:center">Ödeme Google Play üzerinden alınır.</p>
    <div class="row2"><button id="vipViews" class="neg" style="background:var(--bg);color:var(--text)">👀 Profilimi kimler gördü</button></div>`);
  $("#vipViews").onclick=openViews;
  $("#vipBuy").onclick=()=>{
    if(!wallet?.adult){closeE();if(wallet?.ageSet)toast("VIP 18 yaş üstüne açık",3000);else askAge(openVip);return}
    toast("Ödeme, TR Play Store'da yayınlanınca Google Play üzerinden açılacak.",3500)};
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
let potwAt=0,potwHTML="";
async function loadPotw(){if(Date.now()-potwAt<120000){const e=$("#potw");if(e)e.innerHTML=potwHTML;return}potwAt=Date.now();
  try{const L=catalog?.leagues||[];for(let t=L.length-1;t>=0;t--){const s=await getDocs(query(collection(fs,"lb_week",wallet.week,"t"+t),orderBy("points","desc"),limit(1)));
    if(!s.empty){const d=s.docs[0];watchUser(d.id);await new Promise(r=>setTimeout(r,400));potwHTML=`<div class="potw">${avHTML(d.id)}<div><small>🌟 Haftanın oyuncusu</small><b>${esc(d.id===me?"Sen!":realName(d.id))}${vipMark(d.id)}</b><span>${L[t].icon} ${esc(L[t].name)} ligi · ${fmtCoin(d.data().points||0)} puan</span></div></div>`;break}}}catch(e){}
  const e=$("#potw");if(e)e.innerHTML=potwHTML}
function renderGamesTab(){
  const el=$("#pane-games");if(!el||!ready)return;setTimeout(loadPotw,0);
  if(!wallet){el.innerHTML='<div class="empty">Yükleniyor…</div>';return}
  const pct=Math.min(100,Math.round(100*(wallet.levelCur||0)/(wallet.levelNext||1)));
  el.innerHTML=`<div class="wcard"><div style="font-size:13px;opacity:.85">Jeton bakiyen</div><div class="bal"><span class="coin"></span>${fmtCoin(wallet.balance)}</div>
    <div class="lv"><b>Seviye ${wallet.level}</b><div class="bar"><i style="width:${pct}%"></i></div><span>${fmtCoin(wallet.levelCur)}/${fmtCoin(wallet.levelNext)} XP</span></div>
    <div class="st">${(()=>{const t=(catalog?.tiers||[])[tierIdx(wallet.balance)];return t?`${t.icon} <b>${esc(t.name)}</b> · `:""})()}${wallet.wins||0} galibiyet · ${wallet.games||0} oyun<br>Bakiyen arttıkça üst salonlar açılır. Seviye atladıkça bilgisayar rakipler zorlaşır.</div></div>
  <div id="potw"></div>
  <div class="playnow">
    <button data-g="pub-okey"><span>🀄</span><b>Okey</b><small>Açık masalar · hemen otur</small></button>
    <button data-g="pub-pool"><span>🎱</span><b>Bilardo</b><small>Açık masalar · hemen otur</small></button>
    <button data-g="pub-pisti" class="pubpisti" ><span>🃏</span><b>Pişti</b><small>Açık masalar · 2 kişilik</small></button>
    <button data-g="pub-tavla" class="pubtavla"><span>🎲</span><b>Tavla</b><small>Açık masalar · 2 kişilik</small></button>
    <button data-g="pub-batak" class="pubbatak"><span>♠️</span><b>İhaleli Batak</b><small>Açık masalar · 4 kişilik</small></button>
    <button data-g="pub-kizma" class="pubkizma"><span>🎯</span><b>Kızma Birader</b><small>Açık masalar · 4 kişilik</small></button>
  </div>
  <div class="gbtns">
    ${(wallet.balance||0)<(catalog?.rescue?.below||1000)&&wallet.rescueDay!==wallet.today?`<button data-g="rescue" class="hot" style="grid-column:span 2;background:#fff4d6"><span>🆘</span>Jetonun bitti mi? ${fmtCoin(catalog?.rescue?.amount||10000)} jeton desteği al<i class="dot"></i></button>`:""}
    ${(()=>{const L=(catalog?.leagues||[])[wallet.league||0];return L?`<button data-g="league" class="lgbtn lg${wallet.league||0}" style="grid-column:span 2"><span>${L.icon}</span>${esc(L.name)} ligi<small>Hafta bitimine ${fmtWait(weekLeft())} · ilk 3'e ${fmtCoin(L.prizes[0])} jetona kadar ödül</small></button>`:""})()}
    ${catalog?.tour?`<button data-g="tour" class="tourbtn" style="grid-column:span 2"><span>🏟️</span>Akşam turnuvası<small>${esc(tourState().label)}</small></button>`:""}
    <button data-g="daily" class="${dailyAvailable()?"hot":""}"><span>🎁</span>Günlük hediye${dailyAvailable()?'<i class="dot"></i>':""}</button>
    <button data-g="spin" class="${wallet.spinDay!==wallet.today?"hot":""}"><span>🎡</span>Günlük çark${wallet.spinDay!==wallet.today?'<i class="dot"></i>':""}</button>
    <button data-g="chest" class="${chestLeft()<=0?"hot":""}"><span>🧰</span><span class="chestlbl" style="font-size:inherit">${chestLeft()<=0?"Sandık hazır!":"Sandık · "+fmtWait(chestLeft())}</span>${chestLeft()<=0?'<i class="dot"></i>':""}</button>
    <button data-g="tasks" class="${(wallet.tasks||[]).some(t=>t.done&&!t.claimed)?"hot":""}"><span>✅</span>Görevler ${(wallet.tasks||[]).filter(t=>t.claimed).length}/${(wallet.tasks||[]).length}${(wallet.tasks||[]).some(t=>t.done&&!t.claimed)?'<i class="dot"></i>':""}</button>
    <button data-g="invite"><span>👥</span>Arkadaşını çağır</button>
    <button data-g="store"><span>🪙</span>Jeton al</button>
    <button data-g="rank"><span>🏆</span>Sıralama</button>
    <button data-g="skins"><span>🎨</span>Masa ve ıstaka</button>
    <button data-g="cb"><span>💸</span>Harcama iadesi${wallet.cb&&wallet.cb.amount&&!wallet.cb.claimed?'<i class="dot"></i>':""}</button>
    <button data-g="kelime"><span>🔤</span>Kelimece · günlük bulmaca</button>
    <button data-g="cafe" style="grid-column:span 2"><span>☕</span>Kahvehane · bütün açık masalar</button>
    <button data-g="quiz"><span>🧠</span>Bilgi yarışması</button>
    <button data-g="cal"><span>📅</span>Etkinlik takvimi</button>
    <button data-g="redeem"><span>🎟️</span>Hediye kodu</button>
    <button data-g="city"><span>🏙️</span>Şehir sıralaması</button>
    <button data-g="records"><span>📜</span>Rekorlarım</button>
    <button data-g="club"><span>🏛️</span>${wallet.club?"Kulübüm":"Kulüpler"}</button>
    <button data-g="ach"><span>🏅</span>Başarımlar ${(wallet.ach||[]).length}/${(catalog?.ach||[]).length||16}</button>
    <button data-g="ledger"><span>📜</span>Jeton hareketlerim</button>
    <button data-g="history"><span>🕘</span>Oyun geçmişim</button>
    <button data-g="play"><span>💬</span>Arkadaşınla oyna</button>
    <button data-g="vip" class="vipbtn" style="grid-column:span 2"><span>👑</span>${isVipU(me)?"VIP üyesin · "+new Date(vipU[me]).toLocaleDateString("tr-TR")+" tarihine kadar":"VIP ol"}</button>
    ${isAdminUser?'<button data-g="admin" style="grid-column:span 2"><span>🛠️</span>Yönetim paneli</button>':""}
  </div>
  <div class="empty" style="padding:6px 20px 30px;font-size:12.5px">Jetonlar sadece oyun içinde kullanılır; paraya çevrilemez ve başkasına gönderilemez.</div>`;
}
document.querySelector(".content").addEventListener("click",e=>{const b=e.target.closest("[data-g]");if(!b)return;const g=b.dataset.g;
  if(g==="play"){openInfoModal("Arkadaşınla oyna","Bir arkadaşının ya da grubunun sohbetini aç, üstteki 🎮 düğmesine dokun. Okey veya bilardo masası kurup davet gönderebilirsin.");}
  if(g==="pub-okey")openPublic("okey");if(g==="pub-pool")openPublic("pool");if(g==="pub-pisti")openPublic("pisti");if(g==="pub-tavla")openPublic("tavla");if(g==="pub-batak")openPublic("batak");if(g==="pub-kizma")openPublic("kizma");
  if(g==="daily")openDaily();if(g==="spin")openSpin();if(g==="chest")claimGift("chest");if(g==="rescue")claimGift("rescue");if(g==="tasks")openTasks();if(g==="history")openHistory();if(g==="invite")openInvite();if(g==="ledger")openLedger();
  if(g==="store")openStore();if(g==="rank")openRanking("day");if(g==="league")openLeague();if(g==="tour")openTour();if(g==="ach")openAch();if(g==="club")openClub();if(g==="redeem")openRedeem();if(g==="kelime")openKelime();if(g==="quiz")openQuiz();if(g==="cafe")openCafe();if(g==="cal")openCalendar();if(g==="city")openCity();if(g==="records")openRecords();if(g==="cb")openCashback();if(g==="skins")openSkins();if(g==="admin")openAdmin();if(g==="vip")openVip()});
/* ---------- bildirim merkezi ---------- */
function notifItems(){const it=[];
  for(const u of Object.keys(friends).filter(u=>incomingReq(u)&&!isBlocked(u)))it.push({ic:"🤝",t:`<b>${esc(realName(u))}</b> arkadaşlık isteği gönderdi`,go:()=>{setTabSafe("chats")},at:friends[u].at||0});
  {const now=new Date();for(const u of Object.keys(friends).filter(isFriend)){const at=+friends[u].at||0;if(!at)continue;const d=new Date(at),yrs=now.getFullYear()-d.getFullYear();
    if(yrs>=1&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate())it.push({ic:"🎂",t:`<b>${esc(realName(u))}</b> ile ${yrs}. arkadaşlık yıldönümünüz! Bir kart gönder`,go:()=>{openChat(u);setTimeout(()=>openCards(u),300)},at:2})}}
  const men=raw.filter(m=>m.from!==me&&Array.isArray(m.men)&&m.men.includes(me)&&m.at>(reads[me+"_"+convOfMsg(m)]||0));
  const byC={};for(const m of men)byC[convOfMsg(m)]=m;
  for(const[c,m]of Object.entries(byC))it.push({ic:"@",t:`<b>${esc(realName(m.from))}</b>, ${esc(convTitle(c))} grubunda senden bahsetti`,go:()=>openChat(c),at:m.at});
  if(wallet){
    if(dailyAvailable())it.push({ic:"🎁",t:"Günlük hediyen hazır",go:()=>openDaily(),at:0});
    if(chestLeft()<=0)it.push({ic:"🧰",t:"Sandığın hazır, açmayı unutma",go:()=>claimGift("chest"),at:0});
    if(catalog?.tour){const ts=tourState();if(ts.phase==="live"&&(ts.joined||trHour()<catalog.tour.joinUntil))it.push({ic:"🏟️",t:ts.joined?"Akşam turnuvası başladı, puan toplamaya başla":"Akşam turnuvası başladı, hâlâ katılabilirsin",go:()=>openTour(),at:1})}
    const td=(wallet.tasks||[]).filter(t=>t.done&&!t.claimed).length;
    if(td)it.push({ic:"✅",t:`${td} görev tamamlandı, ödülünü al`,go:()=>openTasks(),at:0});
    if(wallet.balance!=null&&wallet.balance<(catalog?.rescue?.below||1000)&&wallet.rescueDay!==wallet.today)it.push({ic:"🛟",t:"Jetonun azaldı, kurtarma hediyesini alabilirsin",go:()=>claimGift("rescue"),at:0});
  }
  return it.sort((a,b)=>b.at-a.at)}
function setTabSafe(t){const b=document.querySelector(`.tab[data-tab="${t}"]`);if(b)b.click()}
function renderBell(){const b=$("#btnBell");if(!b||!me)return;const n=notifItems().length;b.querySelector("i").textContent=n>9?"9+":n||"";b.classList.toggle("has",n>0)}
$("#btnBell").onclick=()=>{const it=notifItems();
  openInfoModal("🔔 Bildirimler",it.length?it.map((x,i)=>`<div class="nitem" data-n="${i}"><span class="nic">${x.ic}</span><span class="nt">${x.t}</span><span class="nar">›</span></div>`).join(""):'<div class="isub" style="text-align:center;padding:24px 0">Yeni bildirim yok 🎉</div>');
  $("#eBody").onclick=e=>{const r=e.target.closest("[data-n]");if(!r)return;closeAll();$("#emodal").classList.remove("show");it[+r.dataset.n].go()}};
function openGift(peer){
  if(!wallet){toast("Cüzdan yükleniyor, birazdan tekrar dene");return}
  openInfoModal(`🎁 ${realName(peer)} için hediye`,`<p class="isub">Hediye sohbette görünür ve arkadaşının profiline eklenir. Jetonla alınır, jeton olarak geri dönmez.</p><div class="giftgrid">${giftList().map(g=>`<button data-gift="${g.id}" ${(wallet.balance||0)<g.price?"disabled":""}><span>${g.icon}</span><b>${esc(g.name)}</b><small><span class="coin"></span> ${fmtCoin(g.price)}</small></button>`).join("")}</div><p class="isub">Bakiyen: ${fmtCoin(wallet.balance||0)}</p>`);
  $("#eBody").onclick=async e=>{const b=e.target.closest("[data-gift]");if(!b||b.disabled)return;const G=giftOf(b.dataset.gift);
    $("#eBody").querySelectorAll("[data-gift]").forEach(x=>x.disabled=true);
    try{const r=await callApi("/api/wallet",{action:"gift",to:peer,id:G.id});applyWallet({...wallet,...r.wallet});closeE();
      await sendContent(peer,{t:"gift",id:G.id});sfx("win");toast(`${G.icon} ${G.name} gönderildi`)}
    catch(err){toast(err.status===402?"Bakiyen yetmiyor":err.status===403?"Sadece arkadaşlarına hediye gönderebilirsin":"Gönderilemedi");openGift(peer)}};
}
let clubUnsubs=[];
function stopClub(){clubUnsubs.forEach(u=>{try{u()}catch(e){}});clubUnsubs=[]}
function openClub(){
  stopClub();const C=catalog?.club||{price:50000,max:30,icons:["☕"]};
  const top=`<div class="fl" style="margin-top:12px">Bu haftanın kulüpleri</div><div id="clTop"><div class="isub">Yükleniyor…</div></div>`;
  if(!wallet.club){
    openInfoModal("🏛️ Kulüpler",`<p class="isub">Arkadaşlarınla kulüp (kahvehane) kur. Üyelerin lig puanları kulübün haftalık puanına eklenir. En çok ${C.max} üye.</p>
      <div class="fl">Kulübe katıl</div><div class="row2"><input id="clCode" maxlength="6" placeholder="Kulüp kodu (örn. K7M2QX)" style="text-transform:uppercase"><button id="clJoin" style="background:var(--brand)">Katıl</button></div>
      <div class="fl" style="margin-top:10px">Yeni kulüp kur · ${fmtCoin(C.price)} jeton</div><input id="clName" maxlength="24" placeholder="Kulüp adı">
      <div class="clicons">${C.icons.map((x,i)=>`<button data-ic="${x}" class="${i?"":"on"}">${x}</button>`).join("")}</div>
      <div class="row2"><button id="clNew" style="background:#0E7C3A">Kur</button></div>${top}`);
    let icon=C.icons[0];
    $("#eBody").addEventListener("click",e=>{const b=e.target.closest("[data-ic]");if(!b)return;icon=b.dataset.ic;$("#eBody").querySelectorAll("[data-ic]").forEach(x=>x.classList.toggle("on",x===b))});
    $("#clJoin").onclick=async()=>{const code=$("#clCode").value.trim().toUpperCase();if(code.length!==6){toast("6 haneli kulüp kodunu yaz");return}
      try{const r=await callApi("/api/wallet",{action:"clubJoin",code});applyWallet({...wallet,...r.wallet});toast("Kulübe katıldın 🎉");openClub()}catch(e){toast(e.status===404?"Bu kodla kulüp yok":e.status===409?"Kulüp dolu":"Katılınamadı")}};
    $("#clNew").onclick=async()=>{const name=$("#clName").value.trim();if(name.length<3){toast("Kulüp adı en az 3 harf olsun");return}if(hasBad(name)){toast("Kulüp adında uygunsuz kelime var");return}
      if((wallet.balance||0)<C.price){toast("Bakiyen yetmiyor");return}
      try{const r=await callApi("/api/wallet",{action:"clubCreate",name,icon});applyWallet({...wallet,...r.wallet});toast("Kulübün kuruldu 🎉");openClub()}catch(e){toast(e.status===402?"Bakiyen yetmiyor":"Kurulamadı, tekrar dene")}};
  }else{
    openInfoModal("🏛️ Kulübüm",`<div id="clHead" class="clhead"><div class="isub">Yükleniyor…</div></div><div class="fl">Üyeler</div><div id="clMem"></div>
      <div class="row2" style="margin-top:8px"><button id="clShare" style="background:var(--brand)">Kodu paylaş</button><button id="clLeave" style="background:#777">Kulüpten ayrıl</button></div>${top}`);
    const code=wallet.club;
    clubUnsubs.push(onSnapshot(doc(fs,"clubs",code),s=>{if(!$("#clHead"))return;if(!s.exists()){$("#clHead").innerHTML='<div class="isub">Kulüp bulunamadı</div>';return}const c=s.data();(c.members||[]).forEach(watchUser);
      $("#clHead").innerHTML=`<span class="cli">${esc(c.icon||"☕")}</span><div><b>${esc(c.name)}</b><div class="isub">Kod: <b>${esc(code)}</b> · ${(c.members||[]).length}/${C.max} üye</div></div>`;
      $("#clMem").innerHTML=(c.members||[]).map(u=>`<div class="lbrow ${u===me?"me":""}">${avHTML(u)}<span class="nm">${esc(u===me?"Sen":realName(u))}${vipMark(u)}${u===c.owner?" · 👑 kurucu":""}</span></div>`).join("")},()=>{}));
    $("#clShare").onclick=()=>{const t=`TR'de kulübüme katıl! Oyun → Kulüpler → kod: ${code}`;if(navigator.share)navigator.share({text:t}).catch(()=>{});else{navigator.clipboard?.writeText(t);toast("Kopyalandı")}};
    $("#clLeave").onclick=()=>{openModal({title:"Kulüpten ayrıl",text:"Kulüpten ayrılmak istiyor musun?",input:false,ok:"Ayrıl"},async()=>{try{const r=await callApi("/api/wallet",{action:"clubLeave"});applyWallet({...wallet,...r.wallet,club:null});toast("Kulüpten ayrıldın")}catch(e){toast("Yapılamadı")}})};
  }
  clubUnsubs.push(onSnapshot(query(collection(fs,"club_week",wallet.week,"c"),orderBy("points","desc"),limit(20)),async s=>{const rows=s.docs.map(d=>({id:d.id,...d.data()}));
    const info=await Promise.all(rows.map(r=>getDoc(doc(fs,"clubs",r.id)).then(x=>x.exists()?x.data():null).catch(()=>null)));
    const el=$("#clTop");if(!el)return;
    el.innerHTML=rows.length?rows.map((r,i)=>info[i]?`<div class="lbrow ${r.id===wallet.club?"me":""}"><span class="rk">${i<3?["🥇","🥈","🥉"][i]:i+1}</span><span class="cli sm">${esc(info[i].icon||"☕")}</span><span class="nm">${esc(info[i].name)}</span><span class="isub">${(info[i].members||[]).length} üye</span><span class="pt">${fmtCoin(r.points||0)} p</span></div>`:"").join(""):'<div class="isub">Bu hafta henüz puan alan kulüp yok</div>'},()=>{}));
}
$("#eClose").addEventListener("click",stopClub);
function openCashback(){const c=wallet.cb||{today:0,yesterday:0,rate:0,amount:0,claimed:false},T=catalog?.cashback||[{min:10000000,rate:.05},{min:1000000,rate:.01},{min:100000,rate:.01}];
  openInfoModal("💸 Harcama iadesi",`<p class="isub">Masa ücretleri, turnuva katılımı ve hediyeler için harcadığın jetonun bir kısmı ertesi gün iade edilir.</p>
    ${[...T].reverse().map(x=>`<div class="pk"><b style="flex:1">${fmtCoin(x.min)}+ jeton harcama</b><span>%${Math.round(x.rate*100)} iade</span></div>`).join("")}
    <div class="pk" style="display:block"><div>Dün harcadığın: <b>${fmtCoin(c.yesterday)}</b></div><div>Bugün harcadığın: <b>${fmtCoin(c.today)}</b> <span class="isub">(yarın iade alınır)</span></div></div>
    <div class="row2"><button id="cbGo" style="background:var(--brand)" ${!c.amount||c.claimed?"disabled":""}>${c.claimed?"Bugünkü iade alındı ✓":c.amount?`İadeni al · +${fmtCoin(c.amount)} jeton`:"Dün için iade yok"}</button></div>`);
  $("#cbGo").onclick=async()=>{$("#cbGo").disabled=true;try{const r=await callApi("/api/wallet",{action:"cashback"});applyWallet({...wallet,...r.wallet});sfx("coin");toast(`💸 +${fmtCoin(r.gift.amount)} jeton iade`);renderGamesTab();openCashback()}catch(e){toast("Alınamadı");$("#cbGo").disabled=false}}}
async function openKelime(q,guess){
  let r;try{r=await callApi("/api/wallet",guess!=null?{action:"kelime",q,guess}:{action:"kelime"})}catch(e){toast(e.status===400?"Harf sayısı tutmuyor":"Yüklenemedi");return}
  if(r.wallet)applyWallet({...wallet,...r.wallet});if(r.gift){sfx("win");toast(`🎉 Bildin! +${fmtCoin(r.gift.amount)} jeton`,3000)}
  const solved=r.kel.filter(x=>x.ok).length;
  openInfoModal("🔤 Kelimece",`<p class="isub">Her gün 5 soru. İpucunu oku, kelimeyi bul. Her soru için ${r.tries} hakkın var, her doğruya ${fmtCoin(r.prize)} jeton. 🟩 doğru yer · 🟨 kelimede var. Bugün: <b>${solved}/5</b></p>
    ${r.kel.map((k,i)=>{const over=k.ok||k.g.length>=r.tries;return`<div class="kq ${k.ok?"ok":over?"fail":""}"><div class="kqh"><b>${i+1}. ${esc(k.clue)}</b><span>${k.len} harf · “${esc(k.first)}” ile başlar</span></div>
      ${k.g.map((g,j)=>`<div class="kr">${[...g].map((c,x)=>`<span class="k${k.s[j][x]}">${esc(c)}</span>`).join("")}</div>`).join("")}
      ${over?(k.ok?`<div class="kres">✅ Bildin</div>`:`<div class="kres">Cevap: <b>${esc(k.ans)}</b></div>`):`<div class="kin"><input data-kq="${i}" maxlength="${k.len+3}" autocomplete="off" placeholder="${"_ ".repeat(k.len).trim()}"><button data-kgo="${i}">Dene (${r.tries-k.g.length})</button></div>`}</div>`}).join("")}`);
  const go=i=>{const inp=document.querySelector(`[data-kq="${i}"]`);const v=inp.value.trim().replace(/\s+/g,"");const L=r.kel[i].len;if([...v].length!==L){toast(`${L} harfli olmalı`);return}openKelime(i,v)};
  $("#eBody").onclick=e=>{const b=e.target.closest("[data-kgo]");if(b)go(+b.dataset.kgo)};
  $("#eBody").onkeydown=e=>{const t=e.target.closest("[data-kq]");if(t&&e.key==="Enter")go(+t.dataset.kq)};
  const firstOpen=document.querySelector("#eBody [data-kq]");if(firstOpen&&q!=null){const nx=document.querySelector(`[data-kq="${q}"]`)||firstOpen;nx.focus()}}
async function openQuiz(answers){let r;try{r=await callApi("/api/wallet",answers?{action:"quiz",answers}:{action:"quiz"})}catch(e){toast("Yüklenemedi");return}
  if(r.wallet)applyWallet({...wallet,...r.wallet});if(r.gift){sfx("win");toast(`🧠 +${fmtCoin(r.gift.amount)} jeton`,3000)}
  const res=r.result,sel=[];
  openInfoModal("🧠 Günün bilgi yarışması",`<p class="isub">Her gün 5 soru, her doğruya ${fmtCoin(r.prize)} jeton. Tek hakkın var.</p>${r.qs.map((q,i)=>`<div class="qz"><b>${i+1}. ${esc(q.q)}</b><div>${q.o.map((o,j)=>`<button data-q="${i}" data-o="${j}" class="${res?(res.correct[i]===j?"ok":res.ans[i]===j?"bad":""):""}" ${res?"disabled":""}>${esc(o)}</button>`).join("")}</div></div>`).join("")}
    ${res?`<div class="pk" style="justify-content:center"><b>${res.n}/5 doğru</b> · yarın yeni sorular</div>`:`<div class="row2"><button id="qzGo" style="background:var(--brand)">Cevapları gönder</button></div>`}`);
  if(!res){$("#eBody").onclick=e=>{const b=e.target.closest("[data-q]");if(!b)return;const i=+b.dataset.q;sel[i]=+b.dataset.o;b.parentElement.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b))};
    $("#qzGo").onclick=()=>{if(sel.filter(x=>x!=null).length<r.qs.length){toast("Bütün soruları cevapla");return}openQuiz(sel)}}}
function openCalendar(){const T=catalog?.tour||{start:20,end:23,fee:100000};
  openInfoModal("📅 Etkinlik takvimi",[["🎁","Her gün 00:00","Günlük giriş hediyesi, Kelimece, bilgi yarışması ve görevler yenilenir"],["🧰","Her 4 saatte","Bedava sandık"],["🏟️",`Her akşam ${T.start}:00–${T.end}:00`,`Akşam turnuvası (katılım ${fmtCoin(T.fee)} jeton)`],["🏆","Her gün 00:01","Günlük sıralama ödülleri"],["🥇","Her pazartesi 00:01","Haftalık lig kapanışı, yükselme ve düşme"],["👑","Her ayın 1'i","Aylık sıralama ve ayın davet şampiyonları ödülleri"],["💸","Her gün","Dünkü harcamaya göre iade"]].map(x=>`<div class="pk"><span style="font-size:24px">${x[0]}</span><div><b>${x[1]}</b><div class="isub">${x[2]}</div></div></div>`).join(""))}
function openCafe(){openInfoModal("☕ Kahvehane · bütün açık masalar",'<div id="cafeL"><div class="isub">Yükleniyor…</div></div>');
  Promise.all([getDocs(query(collection(fs,"games"),where("public","==",true),where("status","==","lobby"),limit(60))),getDocs(query(collection(fs,"games"),where("public","==",true),where("status","==","play"),limit(60)))]).then(([a,b])=>{
    const rows=[...a.docs,...b.docs].map(d=>({id:d.id,...d.data()})).filter(g=>Date.now()-(g.updatedAt||g.at||0)<10*60e3);rows.forEach(g=>g.seats.forEach(x=>x&&x.uid&&watchUser(x.uid)));
    const el=$("#cafeL");if(!el)return;el.innerHTML=rows.length?rows.map(g=>{const t=g.type||"okey",n=g.seats.filter(Boolean).length;return`<div class="pk pubrow" data-cafe="${g.id}" style="cursor:pointer"><span style="font-size:26px">${gk(t)[0]}</span><div style="flex:1"><b>${gk(t)[1]}</b> · ${g.stake?fmtCoin(g.stake)+" jeton":"ücretsiz"}<div class="isub">${g.status==="lobby"?`${n}/${g.seats.length} kişi · oturulabilir`:"oynanıyor · izle"}</div></div><span>${g.status==="lobby"?"Otur ›":"İzle ›"}</span></div>`}).join(""):'<div class="isub">Şu an açık masa yok. Oyun sekmesinden bir masa aç!</div>';
    el.onclick=e=>{const r=e.target.closest("[data-cafe]");if(!r)return;closeE();openGame(r.dataset.cafe)}}).catch(()=>{const el=$("#cafeL");if(el)el.innerHTML='<div class="isub">Yüklenemedi</div>'})}
function weeklySummary(){try{const wk=wallet&&wallet.week;if(!wk||localStorage.getItem("tr-wsum")===wk)return;const first=!localStorage.getItem("tr-wsum");localStorage.setItem("tr-wsum",wk);if(first)return;
  loadHistory().then(h=>{const from=Date.now()-7*86400e3,lw=h.filter(x=>x.at>from-86400e3*0&&x.at<Date.now());const n=lw.length,wn=lw.filter(x=>x.won).length;if(!n)return;
    const ll=wallet.lastLeague;openInfoModal("📬 Haftalık özetin",`<div class="recg"><div><b>${n}</b><span>oyun</span></div><div><b>${wn}</b><span>galibiyet</span></div><div><b>%${Math.round(100*wn/n)}</b><span>kazanma oranı</span></div><div><b>${ll?(ll.rank+". / "+ll.of):"–"}</b><span>ligdeki sıran</span></div></div><p class="isub" style="text-align:center">Yeni hafta başladı, bol şans! 🍀</p>`)}).catch(()=>{})}catch(e){}}
function openRedeem(){openModal({title:"🎟️ Hediye kodu",text:"Elindeki hediye kodunu yaz.",placeholder:"örn. BAYRAM2026",ok:"Kullan"},async v=>{
  try{const r=await callApi("/api/wallet",{action:"redeem",code:v});applyWallet({...wallet,...r.wallet});sfx("coin");toast(`🎉 +${fmtCoin(r.gift.amount)} jeton`)}catch(e){toast(e.status===404?"Bu kod geçersiz":e.status===409?"Bu kodu zaten kullandın":e.status===410?"Bu kodun kullanım hakkı bitmiş":"Kullanılamadı",3000)}})}
function openCity(){const C=catalog?.cities||[];const mo=new Date(Date.now()+3*3600e3).toISOString().slice(0,7).replace("-","");
  openInfoModal("🏙️ Şehir sıralaması",`<p class="isub">Oyunlarda kazandığın lig puanları şehrine yazılır. Bu ay en çok puan toplayan şehirler:</p>
    <div class="row2"><select id="ctSel" style="flex:1"><option value="">Şehrini seç…</option>${C.map(c=>`<option ${wallet.city===c?"selected":""}>${esc(c)}</option>`).join("")}</select></div><div id="ctList"><div class="isub">Yükleniyor…</div></div>`);
  $("#ctSel").onchange=async e=>{if(!e.target.value)return;try{const r=await callApi("/api/wallet",{action:"city",city:e.target.value});applyWallet({...wallet,...r.wallet});toast("Şehrin: "+e.target.value)}catch(err){toast("Kaydedilemedi")}};
  getDocs(query(collection(fs,"lb_city",mo,"c"),orderBy("points","desc"),limit(30))).then(s=>{const el=$("#ctList");if(!el)return;el.innerHTML=s.empty?'<div class="isub">Bu ay henüz puan yok</div>':s.docs.map((d,i)=>`<div class="lbrow ${d.data().name===wallet.city?"me":""}"><span class="rk">${i<3?["🥇","🥈","🥉"][i]:i+1}</span><span class="nm">${esc(d.data().name)}</span><span class="pt">${fmtCoin(d.data().points||0)} p</span></div>`).join("")}).catch(()=>{const el=$("#ctList");if(el)el.innerHTML=""})}
async function openRecords(){openInfoModal("📜 Rekorlarım",'<div class="isub">Yükleniyor…</div>');let h=[];try{h=await loadHistory()}catch(e){}
  const best=h.reduce((a,x)=>x.delta>a?x.delta:a,0),G={};h.forEach(x=>{G[x.type]=G[x.type]||{p:0,w:0};G[x.type].p++;if(x.won)G[x.type].w++});
  const yr=new Date().getFullYear(),yh=h.filter(x=>new Date(x.at).getFullYear()===yr),fav=Object.entries(G).sort((a,b)=>b[1].p-a[1].p)[0];
  $("#eBody").innerHTML=`<div class="recg"><div><b>${fmtCoin(wallet.wins||0)}</b><span>toplam galibiyet</span></div><div><b>${fmtCoin(wallet.games||0)}</b><span>toplam oyun</span></div><div><b>${wallet.maxStreak||0}</b><span>en uzun seri</span></div><div><b>${fmtCoin(best)}</b><span>tek oyunda en büyük kazanç</span></div></div>
    <div class="fl">Oyunlara göre (son 100 oyun)</div>${Object.entries(G).map(([k,v])=>`<div class="hist"><span>${gk(k)[0]} ${gk(k)[1]}</span><span>${v.w}/${v.p} galibiyet · %${Math.round(100*v.w/v.p)}</span></div>`).join("")||'<div class="isub">Henüz oyun yok</div>'}
    <div class="vipcard" style="margin-top:12px;background:linear-gradient(135deg,#D7261E,#7a0a10)"><div class="vt" style="color:#fff">${yr} özetin</div><div class="vs">${yh.length} oyun · ${yh.filter(x=>x.won).length} galibiyet${fav?` · en sevdiğin: ${gk(fav[0])[1]}`:""}</div></div>
    <div class="row2"><button id="recShare" style="background:var(--brand)">Özetimi paylaş</button></div>`;
  $("#recShare").onclick=()=>{const t=`TR'de ${yr} özetim: ${yh.length} oyun, ${yh.filter(x=>x.won).length} galibiyet, en uzun serim ${wallet.maxStreak||0}! ${location.origin}`;if(navigator.share)navigator.share({text:t}).catch(()=>{});else{navigator.clipboard?.writeText(t);toast("Kopyalandı")}}}
// bilgisayara / telefona kur (PWA)
let installEvt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installEvt=e;const b=document.querySelector('[data-act="install"]');if(b)b.style.display=""});
function openAch(){
  const A=catalog?.ach||[],have=new Set(wallet?.ach||[]);
  openInfoModal("🏅 Başarımlar",`<p class="isub">${have.size}/${A.length} başarım · her biri bir kez jeton ödülü verir ve profilinde rozet olarak görünür.</p>`+A.map(a=>`<div class="pk ach ${have.has(a.id)?"on":""}"><span class="ai">${a.icon}</span><div style="flex:1"><b>${esc(a.name)}</b><div class="isub">${esc(a.desc)}</div></div><span class="isub">${have.has(a.id)?"✅":"+"+fmtCoin(a.prize)}</span></div>`).join(""));
}
function openInfoModal(title,html){closeAll();$("#eTitle").textContent=title;$("#eBody").innerHTML=html;overlay.classList.add("show");$("#emodal").classList.add("show")}
function closeE(){$("#emodal").classList.remove("show");overlay.classList.remove("show")}
$("#eClose").onclick=closeE;
function openStore(){
  const pk=(catalog?.packages||[]).map(p=>`<div class="pk"><span class="coin" style="font-size:28px"></span><div><b>${fmtCoin(p.coins)}</b><div class="isub">jeton</div></div><button class="pr" data-buy="${p.id}">${p.price} TL</button></div>`).join("");
  openInfoModal("Jeton al",pk+`<p class="isub" style="margin-top:8px">Ödeme, TR Play Store'da yayınlandığında Google Play üzerinden açılacak. Şimdilik jeton yükleme için yöneticiyle iletişime geç.</p>`);
  $("#eBody").onclick=e=>{if(e.target.closest("[data-buy]"))toast("Ödeme henüz açık değil. Play Store yayınından sonra aktif olacak.",3500)};
}
const SW_COLORS={klasik:"#f7f1e3",fildisi:"linear-gradient(#fffaf0,#f1e4c8)",mermer:"linear-gradient(135deg,#fafafa,#d8d8de)",sedef:"linear-gradient(135deg,#fff6fb,#e6f2ff,#fdf0e6)",vip_mor:"linear-gradient(135deg,#4a1a6b,#2a0b40)",vip_mermer:"linear-gradient(135deg,#f4f1ea,#cfc8bb)",vip_altin:"linear-gradient(135deg,#1b3d2a,#c9a43a)",vip_sedef:"linear-gradient(135deg,#f6efe6,#c9d6e8,#e8d3e6)",vip_elmas:"linear-gradient(135deg,#dff3ff,#8fc6e8)",yesil:"#0b5a31",lacivert:"#122a57",bordo:"#64121f",siyah:"#222",ay:"#C8102E",ceviz:"#7c5428",abanoz:"#1e140e",kiraz:"#7a2a22",altin:"#c79a2a"};
function openSkins(){
  const sec=(kind,title)=>`<div class="fl" style="margin-top:6px">${title}</div>`+(catalog?.skins?.[kind]||[]).map(it=>{const own=it.vip?isVipU(me):(wallet.owned?.[kind]||[]).includes(it.id)||!it.price,eq=mySkin(kind)===it.id;
    if(it.vip)return`<div class="pk"><span class="sw" style="background:${SW_COLORS[it.id]||"#888"}"></span><div><b style="font-size:15px">${esc(it.name)}</b><div class="isub">👑 VIP'e özel</div></div><button class="pr ${eq?"eq":own?"own":"vipx"}" data-skin="${kind}:${it.id}" ${eq?"disabled":""}>${eq?"Kullanılıyor":own?"Kullan":"VIP ol"}</button></div>`;
    return`<div class="pk"><span class="sw" style="background:${SW_COLORS[it.id]||"#888"}"></span><div><b style="font-size:15px">${esc(it.name)}</b><div class="isub">${it.price?fmtCoin(it.price)+" jeton":"Ücretsiz"}</div></div><button class="pr ${eq?"eq":own?"own":""}" data-skin="${kind}:${it.id}" ${eq?"disabled":""}>${eq?"Kullanılıyor":own?"Kullan":"Satın al"}</button></div>`}).join("");
  openInfoModal("Masa ve ıstaka",sec("table","Masa deseni")+sec("rack","Istaka")+(catalog?.skins?.tile?sec("tile","Okey taşları"):""));
  $("#eBody").onclick=async e=>{const b=e.target.closest("[data-skin]");if(!b)return;const [kind,id]=b.dataset.skin.split(":");const own=(wallet.owned?.[kind]||[]).includes(id)||((catalog?.skins?.[kind]||[]).find(x=>x.id===id)||{}).price===0;
    const it=catalog.skins[kind].find(x=>x.id===id);
    if(it.vip&&!isVipU(me)){openVip();return}
    if(it.vip){b.disabled=true;try{const r=await callApi("/api/wallet",{action:"equip",kind,id});applyWallet({...r.wallet});openSkins();toast("Değiştirildi")}catch(err){toast("İşlem yapılamadı");b.disabled=false}return}
    if(!own&&(wallet.balance||0)<it.price){toast("Yeterli jetonun yok");return}
    b.disabled=true;try{const r=await callApi("/api/wallet",{action:own?"equip":"buySkin",kind,id});applyWallet({...r.wallet});catalog=r.wallet.catalog;openSkins();toast(own?"Değiştirildi":"Satın alındı 🎉")}catch(err){toast("İşlem yapılamadı");b.disabled=false}};
}
function weekLeft(){const d=new Date(Date.now()+3*3600e3);const dow=(d.getUTCDay()+6)%7;
  const end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dow+7)-3*3600e3;return end-Date.now()}
function trHour(){return new Date(Date.now()+3*3600e3).getUTCHours()}
function tourState(){const T=catalog.tour,h=trHour(),joined=wallet.tourDay===wallet.today;
  if(h<T.start)return{phase:"pre",joined,label:joined?`Kaydın tamam · ${T.start}:00'de başlıyor`:`Bugün ${T.start}:00–${T.end}:00 · katılım ${fmtCoin(T.fee)} jeton`};
  if(h<T.end)return{phase:"live",joined,label:joined?`Devam ediyor · ${T.end}:00'e kadar oyna, puan topla`:h<T.joinUntil?`Başladı! ${T.joinUntil}:00'ye kadar katılabilirsin`:`Son saat · yeni katılım kapandı`};
  return{phase:"post",joined,label:`Bitti · yarın ${T.start}:00'de yenisi`}}
let tourUnsub=null;
function openTour(){
  const T=catalog.tour,st=tourState(),day=wallet.today,lt=wallet.lastTour;
  const last=lt&&lt.day!==day?`<div class="pk" style="display:block;margin-bottom:8px"><b>Son turnuvan:</b> ${lt.refund?"yeterli katılım olmadığı için ücretin iade edildi":lt.rank?`${lt.rank}. oldun (${lt.of} kişi)${lt.amount?` · +${fmtCoin(lt.amount)} jeton`:""}`:"puan alamadın"}</div>`:"";
  const canJoin=!st.joined&&trHour()<T.joinUntil;
  openInfoModal("🏟️ Akşam turnuvası",`${last}<div class="tourhead"><div><b>${T.start}:00 – ${T.end}:00</b><span>Her akşam</span></div><div><b id="tPool">…</b><span>Ödül havuzu</span></div><div><b id="tN">…</b><span>Katılımcı</span></div></div>
    <div class="isub" style="margin:8px 0">Katılım ${fmtCoin(T.fee)} jeton. Turnuva saatinde oynadığın oyunlar puan getirir (arkadaşlarınla ya da jetonlu masalarda; galibiyet jetonlu masada 2 kat). Havuzun %${Math.round((catalog.rake||.05)*100)}'i kasaya kalır, kalanı ilk 3'e %50 / %30 / %20 dağıtılır. 3'ten az kişi katılırsa ücretler iade edilir. Ödüller gece 00:01'de yüklenir.</div>
    ${canJoin?`<div class="row2"><button id="tJoin" style="background:var(--brand)">Katıl · ${fmtCoin(T.fee)} jeton</button></div>`:st.joined?`<div class="pk" style="justify-content:center">✅ Kayıtlısın${st.phase==="pre"?` · ${T.start}:00'de başlıyor`:st.phase==="live"?" · hadi oyna!":""}</div>`:""}
    <div class="fl" style="margin-top:8px">Sıralama</div><div id="lbList"><div class="empty">Yükleniyor…</div></div>`);
  if($("#tJoin"))$("#tJoin").onclick=async()=>{
    if(!wallet?.adult){closeE();if(wallet?.ageSet)toast("Jetonlu turnuva 18 yaş üstüne açık",3000);else askAge(openTour);return}
    if((wallet.balance||0)<T.fee){toast("Yeterli jetonun yok");return}
    $("#tJoin").disabled=true;
    try{const r=await callApi("/api/wallet",{action:"tjoin"});applyWallet({...wallet,...r.wallet});toast("Turnuvaya katıldın 🎉");openTour()}
    catch(e){$("#tJoin").disabled=false;toast(e.status===409?"Katılım şu an kapalı":"Katılınamadı")}};
  if(tourUnsub)tourUnsub();if(lbUnsub)lbUnsub();
  tourUnsub=onSnapshot(doc(fs,"tour",day),s=>{const n=s.exists()?(+s.data().n||0):0;const pool=Math.round(n*T.fee*(1-(catalog.rake||.05)));
    if($("#tPool"))$("#tPool").textContent=fmtCoin(pool);if($("#tN"))$("#tN").textContent=n},()=>{});
  lbUnsub=onSnapshot(query(collection(fs,"tour",day,"p"),orderBy("points","desc"),limit(100)),s=>{
    const rows=s.docs.map(d=>({uid:d.id,...d.data()}));rows.forEach(r=>watchUser(r.uid));
    const el=$("#lbList");if(!el)return;
    el.innerHTML=rows.length?rows.map((r,i)=>`<div class="lbrow ${r.uid===me?"me":""}"><span class="rk">${(r.points||0)>0&&i<3?["🥇","🥈","🥉"][i]:i+1}</span>${avHTML(r.uid)}<span class="nm">${esc(r.uid===me?"Sen":realName(r.uid))}${vipMark(r.uid)}</span><span class="isub">${r.games||0} oyun</span><span class="pt">${fmtCoin(r.points||0)} p</span></div>`).join(""):'<div class="empty">Henüz katılan yok. İlk sen katıl!</div>';
  },()=>{});
}
$("#eClose").addEventListener("click",()=>{if(tourUnsub){tourUnsub();tourUnsub=null}});
function openLeague(){
  const Ls=catalog?.leagues||[],t=wallet.league||0,L=Ls[t];if(!L)return;
  const mv=Math.round((catalog.leagueMove||.2)*100),ll=wallet.lastLeague;
  const last=ll&&ll.week!==wallet.week?`<div class="pk" style="display:block;margin-bottom:8px"><b>Geçen hafta:</b> ${esc(Ls[ll.tier]?.name||"")} liginde ${ll.rank}. oldun (${ll.of} oyuncu)${ll.prize?` · +${fmtCoin(ll.prize)} jeton`:""}${ll.move>0?" · ⬆️ yükseldin!":ll.move<0?" · ⬇️ düştün":""}</div>`:"";
  openInfoModal(`${L.icon} ${L.name} ligi`,`${last}<div class="lgpath">${Ls.map((x,i)=>`<span class="${i===t?"on":""}">${x.icon}<small>${esc(x.name)}</small></span>`).join("<i>›</i>")}</div>
    <div class="isub" style="margin:6px 0">Hafta bitimine <b>${fmtWait(weekLeft())}</b>. İlk %${mv} üst lige çıkar${t>0?`, son %${mv} alt lige düşer`:""}. Ödüller: 🥇 ${fmtCoin(L.prizes[0])} · 🥈 ${fmtCoin(L.prizes[1])} · 🥉 ${fmtCoin(L.prizes[2])} jeton.</div>
    <div class="isub" style="margin-bottom:6px">Puan: galibiyette oyun puanı (jetonlu masada 2 katı), yenilgide 1 katılım puanı. Bilgisayara karşı ücretsiz masalar sayılmaz.</div><div id="lbList"><div class="empty">Yükleniyor…</div></div>`);
  if(lbUnsub)lbUnsub();
  lbUnsub=onSnapshot(query(collection(fs,"lb_week",wallet.week,"t"+t),orderBy("points","desc"),limit(100)),s=>{
    const rows=s.docs.map(d=>({uid:d.id,...d.data()})).filter(x=>(x.points||0)>0);rows.forEach(r=>watchUser(r.uid));
    const n=rows.length,up=t<Ls.length-1?Math.max(1,Math.ceil(n*(catalog.leagueMove||.2))):0,down=t>0&&n>=5?Math.ceil(n*(catalog.leagueMove||.2)):0;
    const el=$("#lbList");if(!el)return;
    el.innerHTML=n?rows.map((r,i)=>`<div class="lbrow ${r.uid===me?"me":""} ${i<up?"up":i>=n-down?"down":""}"><span class="rk">${i<3?["🥇","🥈","🥉"][i]:i+1}</span>${avHTML(r.uid)}<span class="nm">${esc(r.uid===me?"Sen":realName(r.uid))}${vipMark(r.uid)}</span><span class="isub">${i<up?"⬆️":i>=n-down?"⬇️":""}</span><span class="pt">${fmtCoin(r.points)} p</span></div>`).join(""):`<div class="empty">Bu hafta henüz kimse puan almadı. Bir arkadaşınla ya da jetonlu masada oyna, ilk sen ol!</div>`;
  },()=>{const el=$("#lbList");if(el)el.innerHTML='<div class="empty">Lig yüklenemedi</div>'});
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
  if(!window.__isMod)$("#adOut").insertAdjacentHTML("beforebegin",`<div class="row2"><button id="adNotice" style="background:#555">📢 Duyuru / bakım</button><button id="adStats" style="background:#555">📈 Hata ve görüşler</button></div>
    <div class="row2"><button id="adCodeMk" style="background:#555">🎟️ Hediye kodu</button><button id="adAlerts" style="background:#555">🚨 Jeton alarmı</button></div>
    <div class="row2"><button id="adCsv" style="background:#555">📊 Kasa raporu (Excel)</button><button id="adMod" style="background:#555">🛡️ Moderatörler</button></div>`);
  if(window.__isMod){$("#adOut").insertAdjacentHTML("beforebegin",'<p class="isub">Moderatör olarak şikâyetleri inceleyebilir, en fazla 7 gün askıya alabilir ve not ekleyebilirsin.</p>');return}
  $("#adOut").insertAdjacentHTML("beforebegin",`<div class="row2"><button id="adEvent" style="background:#555">🎉 Mevsimlik etkinlik</button><button id="adCafe" style="background:#555">☕ Bütün açık masalar</button></div>`);
  $("#adEvent").onclick=()=>{$("#adOut").innerHTML=`<input id="evN" maxlength="40" placeholder="Etkinlik adı (ör. Ramazan Bayramı)"><input id="evM" inputmode="numeric" placeholder="Günlük hediye çarpanı (1-3)"><input id="evD" inputmode="numeric" placeholder="Kaç gün (0 = kapat)"><div class="row2"><button id="evGo2" style="background:var(--brand)">Kaydet</button></div>`;
    $("#evGo2").onclick=async()=>{try{await callApi("/api/admin",{action:"event",name:$("#evN").value,mul:+$("#evM").value,days:+$("#evD").value});toast("Etkinlik güncellendi")}catch(e){toast("Olmadı")}}};
  $("#adCafe").onclick=()=>{closeE();openCafe()};
  $("#adCodeMk").onclick=()=>{$("#adOut").innerHTML=`<input id="gcA" inputmode="numeric" placeholder="Jeton miktarı (örn. 50000)"><input id="gcU" inputmode="numeric" placeholder="Kaç kişi kullanabilir (örn. 100)"><input id="gcC" maxlength="16" placeholder="Kod (boş bırak, otomatik)"><div class="row2"><button id="gcGo" style="background:var(--brand)">Oluştur</button></div><div id="gcOut"></div>`;
    $("#gcGo").onclick=async()=>{try{const r=await callApi("/api/admin",{action:"mkcode",amount:+$("#gcA").value.replace(/\D/g,""),uses:+$("#gcU").value.replace(/\D/g,"")||1,code:$("#gcC").value});$("#gcOut").innerHTML=`<div class="idbox">${esc(r.code)}</div>`}catch(e){toast("Oluşturulamadı")}}};
  $("#adAlerts").onclick=async()=>{$("#adOut").innerHTML='<div class="isub">Yükleniyor…</div>';try{const r=await callApi("/api/admin",{action:"alerts"});const nm=u=>{const x=r.names[u]||{};return esc((x.name||"?")+" ("+fmtCode(x.code||"")+")")};
    $("#adOut").innerHTML=`<div class="fl">Son 24 saatte 1.000.000+ hareketler</div>${r.big.map(x=>`<div class="hist"><span>${nm(x.uid)} · ${esc(x.reason)}</span><b style="color:${x.delta<0?"#E53935":"#0E7C3A"}">${x.delta>0?"+":""}${fmtCoin(x.delta)}</b></div>`).join("")||'<div class="isub">Yok</div>'}
      <div class="fl">24 saatte en çok net değişim</div>${r.top.map(([u,v])=>`<div class="hist"><span>${nm(u)}</span><b style="color:${v<0?"#E53935":"#0E7C3A"}">${v>0?"+":""}${fmtCoin(v)}</b></div>`).join("")}`}catch(e){$("#adOut").innerHTML='<div class="isub">Yüklenemedi</div>'}};
  $("#adCsv").onclick=async()=>{try{const r=await callApi("/api/admin",{action:"houseRows",days:30});const lines=[["Tarih","Net","Kesinti","Bilgisayar kazancı","Bilgisayar payı"].join(";"),...r.rows.map(x=>[new Date(x.at).toLocaleString("tr-TR"),x.net||0,x.rake||0,x.botWin||0,x.botStake||0].join(";"))];
    const blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="tr-kasa-raporu-30-gun.csv";a.click();toast("Rapor indirildi (Excel ile açılır)")}catch(e){toast("Rapor alınamadı")}};
  $("#adMod").onclick=()=>{$("#adOut").innerHTML=`<input id="mdC" inputmode="numeric" placeholder="Moderatörün TR ID'si"><div class="row2"><button id="mdOn" style="background:#0E7C3A">Moderatör yap</button><button id="mdOff" style="background:#777">Moderatörlüğü al</button></div>`;
    const go=async on=>{try{await callApi("/api/admin",{action:"mod",code:$("#mdC").value,on});toast(on?"Moderatör yapıldı":"Moderatörlük alındı")}catch(e){toast(e.status===404?"Bu ID yok":"Olmadı")}};$("#mdOn").onclick=()=>go(true);$("#mdOff").onclick=()=>go(false)};
  $("#adNotice").onclick=()=>{$("#adOut").innerHTML=`<textarea id="anT" maxlength="300" rows="3" style="width:100%" placeholder="Herkese gösterilecek duyuru (boş bırakıp kaydedersen kaldırılır)"></textarea><label class="tgl"><span><b>Bakım duyurusu</b></span><input type="checkbox" id="anM"></label><div class="row2"><button id="anGo" style="background:var(--brand)">Yayınla</button></div>`;
    $("#anGo").onclick=async()=>{try{await callApi("/api/admin",{action:"notice",text:$("#anT").value,kind:$("#anM").checked?"maint":"info"});toast("Duyuru güncellendi")}catch(e){toast("Olmadı")}}};
  $("#adStats").onclick=async()=>{$("#adOut").innerHTML='<div class="isub">Yükleniyor…</div>';try{const r=await callApi("/api/admin",{action:"stats"});
    $("#adOut").innerHTML=`<div class="pk" style="display:block"><b>Son 24 saatte hata: ${r.errors24h}</b>${(r.lastErrors||[]).slice(0,8).map(x=>`<div class="isub">${esc(String(x.msg).slice(0,120))}</div>`).join("")}</div>
      <div class="pk" style="display:block"><b>Sıradaki oyun oyları</b>${Object.entries(r.votes||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div>${esc(k)}: <b>${v}</b></div>`).join("")||'<div class="isub">Henüz oy yok</div>'}</div>
      <div class="pk" style="display:block"><b>Görüşler</b>${(r.feedback||[]).map(x=>`<div class="isub">“${esc(String(x.text).slice(0,200))}”</div>`).join("")||'<div class="isub">Henüz yok</div>'}</div>`}catch(e){$("#adOut").innerHTML='<div class="isub">Yüklenemedi</div>'}};
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
    <input id="adAmt" inputmode="numeric" placeholder="Miktar (örn. 100000)"><div class="row2" id="adQuick">${[10000,100000,1000000,10000000].map(v=>`<button data-q="${v}" style="background:#555">${fmtCoin(v)}</button>`).join("")}</div><input id="adWhy" maxlength="80" placeholder="Açıklama (isteğe bağlı)">
    <div class="row2"><button id="adAdd">+ Yükle</button><button id="adSub" class="neg">− Düş</button></div><div class="row2"><button id="adVip" style="background:#6b21a8">👑 30 gün VIP ver (300.000 jeton, günde 10.000)</button></div><div id="adConfirm" style="margin-top:8px"></div>
    <div class="fl" style="margin-top:12px">Yönetici notları</div>${(r.notes||[]).map(n=>`<div class="isub">• ${esc(n.text)} <i>(${new Date(n.at).toLocaleDateString("tr-TR")})</i></div>`).join("")}<div class="row2"><input id="adNote" maxlength="1000" placeholder="İç not ekle (kullanıcı görmez)"><button id="adNoteGo" style="background:#555;flex:0 0 auto">Ekle</button></div>
    <div class="fl" style="margin-top:12px">Son hareketler</div>${(r.history||[]).map(h=>`<div class="hist"><span>${esc(h.reason)}</span><span class="isub">${new Date(h.at).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><span class="d" style="color:${h.delta>0?"#0E7C3A":"#E53935"}">${h.delta>0?"+":""}${fmtCoin(h.delta)}</span></div>`).join("")||'<div class="isub">Hareket yok</div>'}`;
  $("#adQuick").onclick=e=>{const b=e.target.closest("[data-q]");if(b)$("#adAmt").value=b.dataset.q};
  $("#adNoteGo").onclick=async()=>{const t=$("#adNote").value.trim();if(!t)return;try{await callApi("/api/admin",{action:"note",code,text:t});toast("Not eklendi");adminLookup()}catch(e){toast("Eklenemedi")}};
  const go=async sign=>{const a=Math.abs(parseInt($("#adAmt").value.replace(/\D/g,""),10));if(!a){toast("Miktar yaz");return}
    const why=$("#adWhy")?.value||"";
    $("#adConfirm").innerHTML=`<div class="pk" style="display:block;border-color:${sign>0?"#0E7C3A":"#E53935"}">${esc(r.user.name||"Kullanıcı")} (${fmtCode(r.user.code)}) hesabına <b>${sign>0?"+":"−"}${fmtCoin(a)}</b> jeton ${sign>0?"yüklensin":"düşülsün"} mi?<div class="row2" style="margin-top:8px"><button id="adNo" style="background:#777">Vazgeç</button><button id="adYes" class="${sign>0?"":"neg"}">Onayla</button></div></div>`;
    $("#adNo").onclick=()=>{$("#adConfirm").innerHTML=""};
    $("#adYes").onclick=async()=>{$("#adYes").disabled=true;try{const x=await callApi("/api/admin",{action:"adjust",code,amount:sign*a,reason:why});toast("Yeni bakiye: "+fmtCoin(x.balance));adminLookup()}catch(e){toast("İşlem yapılamadı");$("#adYes").disabled=false}}};
  $("#adAdd").onclick=()=>go(1);$("#adSub").onclick=()=>go(-1);
  $("#adVip").onclick=()=>openModal({title:"VIP ver",text:"Bu kullanıcıya 30 gün VIP verilsin mi? Her gün 10.000 jeton yüklenecek.",input:false,ok:"Ver"},async()=>{try{await callApi("/api/admin",{action:"grantVip",code});toast("VIP verildi 👑")}catch(e){toast("Olmadı")}});
  if($("#adUnban"))$("#adUnban").onclick=async()=>{try{await callApi("/api/admin",{action:"unban",code});toast("Askı kaldırıldı");adminLookup()}catch(e){toast("Yapılamadı")}};
  $("#adOut").onclick=async e=>{const b=e.target.closest("[data-ban]");if(!b)return;const days=+b.dataset.ban.split(":")[1];
    if(!confirm(days?`${r.user.name||"Bu hesap"} ${days} gün askıya alınsın mı?`:`${r.user.name||"Bu hesap"} kalıcı olarak yasaklansın mı?`))return;
    b.disabled=true;try{await callApi("/api/admin",{action:"ban",code,days,reason:"Kurallara aykırı davranış"});toast("Uygulandı");adminLookup()}catch(err){toast("Yapılamadı");b.disabled=false}};
}
// Masa ücreti seçimi: salonlar bakiyeye göre açılır
function tierIdx(bal){const t=catalog?.tiers||[];let i=0;t.forEach((x,k)=>{if((bal||0)>=x.min)i=k});return i}
function pickStake(cb,type="okey"){
  const bal=wallet?.balance||0,ti=tierIdx(bal),tiers=catalog?.tiers||[{name:"Çaylak Salonu",icon:"🌱",min:0,stakes:[0]}];
  const rk=Math.round((catalog?.rake??0.05)*100);
  const html=tiers.map((t,k)=>{const open=k<=ti;return`<div class="fl" style="margin-top:10px">${t.icon} ${esc(t.name)} <span class="isub">${k<tiers.length-1?fmtCoin(t.min)+" – "+fmtCoin(tiers[k+1].min-1):fmtCoin(t.min)+" ve üzeri"}</span></div><div class="stk">${t.stakes.map(v=>`<button data-stake="${v}" ${!open||v>bal?"disabled":""}>${v?fmtCoin(v):"Ücretsiz"}<small>${!open?fmtCoin(t.min)+" jetonla açılır":v>bal?"Bakiye yetmez":v?"Pot ≈ "+fmtCoin(v*4):"Jetonsuz oyun"}</small></button>`).join("")}</div>`}).join("");
  const isOk=type==="okey";if(!isOk){window.__turnSec=0;window.__canak=false}
  const spd=!isOk?"":`<div class="fl">Okey tur süresi</div><div class="seg" id="tsSeg">${[[0,"Normal · 45 sn"],[30,"Hızlı · 30 sn"],[15,"Şimşek · 15 sn"]].map(([v,l])=>`<button data-ts="${v}" class="${(window.__turnSec||0)===v?"on":""}">${l}</button>`).join("")}</div>`;
  const cnk=!isOk?"":`<label class="tgl"><span><b>🍯 Çanak Okey</b><small>Her elden %5 kasaya, %5 çanağa. Okey atarak biten çanaktakinin hepsini alır (jetonlu masada).</small></span><input type="checkbox" id="cnkT" ${window.__canak?"checked":""}></label>`;
  openInfoModal("Masa ücreti",spd+cnk+`<p class="isub">Oturan herkesten alınır, kazanan potu alır (%${rk} kesinti). Bilgisayar kazanırsa pot kasaya gider. Berabere biterse ücretler iade edilir.</p>${html}`);
  $("#eBody").onclick=e=>{const ts=e.target.closest("[data-ts]");if(ts){window.__turnSec=+ts.dataset.ts;$("#tsSeg").querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===ts));return}
    if(e.target.id==="cnkT"){window.__canak=e.target.checked;return}
    const b=e.target.closest("[data-stake]");if(!b||b.disabled)return;const v=+b.dataset.stake;
    if(v&&!wallet?.adult){closeE();if(wallet?.ageSet)toast("Jetonlu masalar 18 yaş üstüne açık",3000);else askAge(()=>pickStake(cb,type));return}
    closeE();cb(v)};
}
/* ---------- oyunlar: Okey ---------- */
// Masa durumu games/{id}, kendi taşlarım games/{id}/hands/{me}. Bütün hamleler /api/game üzerinden sunucuda doğrulanır.
const T_COLORS=["kırmızı","sarı","mavi","siyah"];
const tIsFake=t=>t===104||t===105, tColor=t=>Math.floor(t/26), tNum=t=>Math.floor((t%26)/2)+1;
function tOkey(ind){const c=tColor(ind),n=tNum(ind);return{c,n:n===13?1:n+1}}
function tIsWild(t,ok){return !tIsFake(t)&&tColor(t)===ok.c&&tNum(t)===ok.n}
function tileHTML(t,ok,{sm=false,sel=false,cls=""}={}){
  if(t==null)return`<div class="tile empty ${sm?"sm":""}"></div>`;
  if(tIsFake(t))return`<div class="tile fake ${sm?"sm":""} ${sel?"sel":""} ${cls}" data-t="${t}" aria-label="sahte okey"><b>★</b><i></i></div>`;
  const w=ok&&tIsWild(t,ok);
  return`<div class="tile c${tColor(t)} ${w?"wild":""} ${sm?"sm":""} ${sel?"sel":""} ${cls}" data-t="${t}" aria-label="${T_COLORS[tColor(t)]} ${tNum(t)}${w?" okey":""}"><b>${tNum(t)}</b><i></i></div>`;
}
const backHTML=(n=1)=>`<div class="tback">${Array.from({length:Math.min(n,3)},()=>'<span></span>').join("")}</div>`;
let game=null;            // {id, data, hand, order, sel, unsubs, busy}
async function gameApi(body,type){
  const t=type||(game&&game.data&&game.data.type);
  const r=await callApi(t==="pool"?"/api/pool":t==="pisti"?"/api/pisti":t==="tavla"?"/api/tavla":t==="batak"?"/api/batak":t==="kizma"?"/api/kizma":"/api/game",body).catch(e=>({error:e.status===409?"busy":"net"}));
  return r;
}
$("#gameBtn").onclick=()=>{if(!cur)return;closeAll();{const gi=$("#gpick [data-gift-open]");if(gi)gi.style.display=isGroupConv(cur)||!isFriend(cur)?"none":""}overlay.classList.add("show");$("#gpick").classList.add("show")};
$("#gpickClose").onclick=()=>{$("#gpick").classList.remove("show");overlay.classList.remove("show")};
$("#gpick").addEventListener("click",async e=>{
  if(e.target.closest("[data-gift-open]")){$("#gpick").classList.remove("show");overlay.classList.remove("show");if(cur&&!isGroupConv(cur))openGift(cur);return}
  const it=e.target.closest("[data-newgame]");if(!it||!cur)return;
  const conv=cur,type=it.dataset.newgame;$("#gpick").classList.remove("show");overlay.classList.remove("show");
  pickStake(async stake=>{
    toast("Masa kuruluyor…",2500);
    const r=await gameApi({action:"create",type,conv,stake,turnSec:window.__turnSec||0,canak:!!window.__canak},type);
    if(!r||!r.id){toast(r&&r.error==="balance"?"Bakiyen yetmiyor":r&&r.error==="stake"?"Bu masa için seviyen yetmiyor":"Masa kurulamadı, tekrar dene");return}
    await sendContent(conv,{t:"game",gid:r.id,kind:type,stake});
    openGame(r.id);
  },type);
});
$("#msgs").addEventListener("click",e=>{const c=e.target.closest("[data-game]");if(c)openGame(c.dataset.game)});

function seatName(s){if(!s)return"Boş";if(s.bot)return s.name||"Bot";return s.uid===me?"Sen":realName(s.uid)}
function seatAv(s){if(!s)return`<div class="av" style="background:rgba(255,255,255,.15)">+</div>`;if(s.bot)return`<div class="av" style="background:#455A64">🤖</div>`;return avHTML(s.uid)}
function setPlaying(type,gid){if(!me||prefs.vis==="none")return;setDoc(doc(fs,"presence",me),{at:Date.now(),vis:prefs.vis,g:type||"",gid:gid||""},{merge:true}).catch(()=>{})}
function openGame(id){
  closeGame(true);try{localStorage.setItem("tr-lastgame",id)}catch(e){}
  game={id,data:null,hand:[],order:[],sel:null,unsubs:[],busy:false,lastHand:new Set()};
  $("#gamescr").classList.add("show");$("#gTable").innerHTML='<div class="lobby">Masa yükleniyor…</div>';$("#gRack").innerHTML="";$("#gMsg").textContent="";
  try{history.pushState({game:id,chat:cur},"")}catch(e){}
  game.unsubs.push(onSnapshot(doc(fs,"games",id),s=>{
    if(!game||game.id!==id)return;
    if(!s.exists()){$("#gTable").innerHTML='<div class="lobby">Bu masaya erişimin yok ya da masa kapandı.</div>';return}
    const prevD=game.data;game.data=s.data();if(!prevD&&mySeatIdx(game.data)>=0)setPlaying(game.data.type||"okey",game.data.public?id:"");(game.data.seats||[]).forEach(x=>x&&x.uid&&watchUser(x.uid));
    {const d=game.data,my=mySeatIdx(d);
      if(prevD&&d.status==="play"&&d.turn===my&&(prevD.turn!==my||prevD.status!=="play"))setTimeout(()=>sfx("turn"),d.type==="pool"?1500:0);
      if(prevD&&prevD.status==="play"&&d.status==="over"&&d.winner===my)setTimeout(()=>sfx("win"),d.type==="pool"?2500:300);
      if(prevD&&prevD.status!=="over"&&d.status==="over")postResult(d);
      if(prevD&&d.type==="tavla"&&prevD.seq!==d.seq){game.tvPath=[];game.tvSel=null;sfx("tile")}
      else if(prevD&&d.type==="batak"&&prevD.seq!==d.seq)sfx("tile");
      else if(prevD&&d.type==="kizma"&&prevD.seq!==d.seq){sfx("ball");if(d.last&&d.last.hit!=null)setTimeout(()=>sfx("win"),200)}
      else if(prevD&&d.type==="pisti"&&prevD.seq!==d.seq){sfx("tile");if(d.last&&d.last.pisti)setTimeout(()=>sfx("win"),250)}
      else if(prevD&&d.type!=="pool"&&d.type!=="pisti"&&JSON.stringify(prevD.discards)!==JSON.stringify(d.discards))sfx("tile")}
    renderGame();
  },()=>{$("#gTable").innerHTML='<div class="lobby">Masa açılamadı.</div>'}));
  game.chat=[];game.chatSeen=Date.now();
  game.unsubs.push(onSnapshot(query(collection(fs,"games",id,"chat"),orderBy("at","desc"),limit(40)),s=>{
    if(!game||game.id!==id)return;
    const rows=s.docs.map(d=>({id:d.id,...d.data()})).filter(m=>typeof m.text==="string").reverse();
    const known=new Set(game.chat.map(m=>m.id));game.chat=rows;
    rows.filter(m=>!known.has(m.id)&&m.at>game.chatSeen-5000).forEach(m=>{watchUser(m.by);showBubble(m)});
    renderGameChat();
  },()=>{}));
  game.unsubs.push(onSnapshot(doc(fs,"games",id,"hands",me),s=>{
    if(!game||game.id!==id)return;
    game.cards=s.exists()&&Array.isArray(s.data().cards)?s.data().cards:[];
    const tiles=s.exists()&&Array.isArray(s.data().tiles)?s.data().tiles:[];
    const prevSet=new Set(game.hand);game.hand=tiles;
    // ıstaka yuvaları: kalanlar yerinde, yeni gelen taş ilk boş yuvaya (son taşın yanına)
    if(game.pendingOut!=null&&!tiles.includes(game.pendingOut))game.pendingOut=null;
    syncSlots(tiles);game.newTiles=new Set(tiles.filter(t=>!prevSet.has(t)&&prevSet.size));
    if(game.sel!=null&&!tiles.includes(game.sel))game.sel=null;
    // yeni el dağıtılınca taşlar otomatik dizilsin (per/seri)
    const rd=game.data&&game.data.round;if(tiles.length>=14&&game.data&&game.data.indicator!=null&&game.autoRound!==rd&&(!prevSet.size||tiles.filter(t=>!prevSet.has(t)).length>2)){game.autoRound=rd;setTimeout(()=>{if(game&&game.hand&&game.hand.length)sortRack("run")},50)}
    renderGame();
  },()=>{}));
  game.poke=setInterval(()=>{const d=game&&game.data;if(!d)return;
    {const tb=$("#gTimer");if(d.status==="play"&&!(d.seats[d.turn]||{}).bot){const lim=d.type==="pool"?60000:d.turnSec?d.turnSec*1000:45000,left=Math.max(0,lim-(Date.now()-(d.lastMoveAt||0)));tb.style.display="";tb.firstElementChild.style.width=(100*left/lim)+"%";tb.classList.toggle("low",left<10000)}else tb.style.display="none"}
    if(d.status==="lobby"&&d.public){const left=Math.ceil((20000-(Date.now()-(d.at||0)))/1000);const el=$("#pubCount");if(el)el.textContent=left>0?`${left} sn içinde dolmazsa bilgisayar oturur`:"Başlıyor…";
      if(left<=0&&mySeatIdx(d)>=0&&!game.poking){game.poking=true;gameApi({action:"poke",id}).finally(()=>{if(game)game.poking=false})}return}
    if(d.status!=="play")return;const s=d.seats[d.turn];if(s&&!s.bot&&s.uid!==me&&Date.now()-(d.lastMoveAt||0)>(d.type==="pool"?62000:d.turnSec?d.turnSec*1000+2000:47000)&&Date.now()-(game.lastPoke||0)>9000){game.lastPoke=Date.now();gameApi({action:"poke",id})}},1000);
}
function closeGame(silent){
  if(!game)return;setPlaying("","");
  {const d=game.data;if(d&&d.public&&d.status==="lobby"&&mySeatIdx(d)>=0)gameApi({action:"leave",id:game.id},d.type)}game.unsubs.forEach(u=>{try{u()}catch(e){}});clearInterval(game.poke);if(game.raf)cancelAnimationFrame(game.raf);game=null;$("#gamescr").classList.remove("pool","okeyg");
  $("#gamescr").classList.remove("show");$("#rotHint").classList.remove("show");leaveLandscape();$("#gChat").classList.remove("show");$("#gBubbles").innerHTML="";
}
$("#gBack").onclick=()=>{try{if(history.state&&history.state.game){history.back();return}}catch(e){}closeGame()};
window.addEventListener("popstate",()=>{if(game&&!(history.state&&history.state.game))closeGame()});
$("#gLeave").onclick=()=>{if(!game)return;const id=game.id;openModal({title:"Masadan kalk",text:game.data&&game.data.status==="play"?"Yerine bilgisayar oyuncu geçecek.":"Masadan kalkmak istiyor musun?",input:false,ok:"Kalk"},async()=>{await gameApi({action:"leave",id});closeGame()})};

function mySeatIdx(d){return(d.seats||[]).findIndex(s=>s&&!s.bot&&s.uid===me)}
function renderGame(){
  if(!game||!game.data)return;
  const d=game.data,my=mySeatIdx(d);
  const gs=$("#gamescr");gs.className="gamescr show felt-"+mySkin("table")+" rack-"+mySkin("rack")+" tile-"+(mySkin("tile")||"klasik");
  if(d.type==="pool"){gs.classList.add("pool");if(d.status==="play"||d.status==="over")askLandscape();return renderPool(d,my)}
  if(d.type==="pisti"){gs.classList.add("pistig");return renderPisti(d,my)}
  if(d.type==="tavla"){gs.classList.add("tavlag");return renderTavla(d,my)}
  if(d.type==="kizma"){gs.classList.add("kizmag");return renderKizma(d,my)}
  if(d.type==="batak"){gs.classList.add("pistig","batakg");return renderBatak(d,my)}
  gs.classList.add("okeyg");
  if(d.status==="play"||d.status==="over")askLandscape();
  $("#gTitleTxt").textContent="Okey";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. el`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  const ok=tOkey(d.indicator);
  const me4=my>=0?my:0;
  const pos=i=>["bottom","right","top","left"][(i-me4+4)%4];
  const isMyTurn=d.status==="play"&&d.turn===my;
  const canDraw=isMyTurn&&d.phase==="draw",canDiscard=isMyTurn&&d.phase==="discard";
  game.canDiscard=canDiscard;
  const leftSeat=(me4+3)%4;
  let html='<div class="otable"><div class="ofelt"></div>';
  d.seats.forEach((s,i)=>{const p=pos(i);if(p==="bottom")return;const n=(d.handCounts||[])[i]??0;
    html+=`<div class="oseat o-${p} ${d.status==="play"&&d.turn===i?"turn":""}"><div class="oav">${seatAv(s)}</div><div class="oname"><b>${esc(seatName(s))}${s&&!s.bot?vipMark(s.uid):""}</b><span>${(d.scores||[])[i]||0} puan</span></div><div class="ohand">${Array.from({length:Math.min(n,15)},()=>"<span></span>").join("")}</div></div>`});
  // atılan taşlar: her oyuncunun önünde son 3 taş üst üste
  const pileOf=i=>{const arr=(d.discards||{})[i]||[];return arr.slice(-3)};
  const stack=(arr)=>arr.length?arr.map((t,k)=>`<div class="st" style="--k:${k}">${tileHTML(t,ok,{sm:true})}</div>`).join(""):'<div class="st">'+tileHTML(null,null,{sm:true})+'</div>';
  d.seats.forEach((s,i)=>{const p=pos(i);
    if(p==="bottom")html+=`<div class="odisc od-me ${canDiscard?"drop":""}" id="gDropDiscard"><div class="stk">${stack(pileOf(i))}</div><span>${canDiscard?"Taşı buraya sürükle":"Attığın"}</span></div>`;
    else if(i===leftSeat)html+=`<div class="odisc od-left ${canDraw&&pileOf(i).length?"take":""}" id="gLeftDisc"><div class="stk">${stack(pileOf(i))}</div><span>${canDraw&&pileOf(i).length?"Dokun, al":"Soldan"}</span></div>`;
    else html+=`<div class="odisc od-${p}"><div class="stk">${stack(pileOf(i))}</div></div>`;
  });
  const flp=d.status==="play"&&game.flipR!==d.round?" flip":"";if(d.status==="play")game.flipR=d.round;
  html+=`<div class="ocenter"><div class="odeck ${canDraw?"take":""}" id="gPile"><div class="dstack">${backHTML(3)}</div><b>${d.pileCount}</b><span>${canDraw?"Dokun, çek":"Deste"}</span></div>
    <div class="oind"><div class="indt${flp}">${tileHTML(d.indicator,null,{sm:true})}</div><span>Gösterge</span></div>
    <div class="oind"><div class="indt${flp} f2">${tileHTML(ok.c*26+(ok.n-1)*2,ok,{sm:true})}</div><span>Okey</span></div>
    ${(()=>{if(my<0||d.status!=="play"||(d.shown||[]).includes(my)||((d.discards||{})[my]||[]).length)return"";const hs=game.hand||[];const tw=hs.some(t=>t!==d.indicator&&!tIsFake(t)&&tColor(t)===tColor(d.indicator)&&tNum(t)===tNum(d.indicator));return tw?`<button class="oshow" id="gShow">👁️ Göstergeyi göster (+1)</button>`:""})()}
    </div>`;
  if(d.canak)html+=`<div class="ocanakbox"><div class="ocanak">🍯<b>${fmtCoin(d.canakPot||0)}</b><span>Çanak</span></div></div>`;
  if(d.status==="over"){
    const w=d.winner;
    html+=`<div class="overbox"><b style="font-size:18px">${w==null?(d.aborted?"Oyun yarım kaldı":"El berabere bitti"):(w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı")}</b><div style="font-size:13px;opacity:.85">${esc(d.log||"")}${d.points?" · +"+d.points+" puan":""}</div>${d.payout?(d.payout.refund?`<div>Berabere: masa ücretleri iade edildi</div>`:d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}${d.payout.canak?` · çanağa: ${fmtCoin(d.payout.canak)}`:""}${d.payout.canakWin?` · 🍯 çanak kazancı: ${fmtCoin(d.payout.canakWin)}`:""}</div>`):""}${d.winHand?winHandHTML(d,ok):""}<div class="sc">${d.seats.map((s,i)=>`<span>${esc(seatName(s))}: <b>${(d.scores||[])[i]||0}</b></span>`).join("")}</div>${rateHTML(d)}${d.host===me?`<button id="gAgain">Yeni el</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni eli masa sahibi başlatır</div>`}</div>`;
  }
  html+='</div>';
  $("#gTable").innerHTML=html;
  // mesaj
  let msg="";
  if(d.status==="play"){
    if(my<0)msg="İzliyorsun";
    else if(canDraw)msg="Sıra sende: desteden çek ya da soldan gelen taşı al";
    else if(canDiscard)msg="Atacağın taşı sağ alttaki yere kaydır · el bitiyorsa otomatik biter";
    else msg=`${esc(seatName(d.seats[d.turn]))} oynuyor…`;
  }
  $("#gMsg").innerHTML=msg;
  // ıstaka: iki kat, 13'er yuva
  syncSlots(game.hand);
  // yan yana duran geçerli perler/seriler yeşil çizgiyle işaretlenir
  const good=new Set();{const okv={c:ok.c,n:ok.n};for(const base of [0,SLOTS/2]){let seg=[];for(let k=base;k<=base+SLOTS/2;k++){const t=k<base+SLOTS/2?game.slots[k]:null;if(t!=null)seg.push(k);else{if(seg.length>=3&&OK.validRun(seg.map(x=>game.slots[x]),okv))seg.forEach(x=>good.add(x));seg=[]}}}}
  const slot=(i)=>{const t=game.slots[i];return`<div class="slot ${good.has(i)?"okg":""}" data-slot="${i}">${t==null?"":tileHTML(t,ok,{sel:game.sel===t,cls:game.newTiles&&game.newTiles.has(t)?"new":""})}</div>`};
  const tier=(from)=>`<div class="tier">${Array.from({length:SLOTS/2},(_,k)=>slot(from+k)).join("")}</div>`;
  $("#gRack").innerHTML=my>=0?`<div class="rackwood">${tier(0)}${tier(SLOTS/2)}</div>`:"";
  $("#gRack").style.display=my>=0?"":"none";$("#gActions").style.display=my>=0&&d.status==="play"?"":"none";$("#pCtrl").style.display="none";
  game.canDraw=canDraw;
  const gsh=$("#gShow");if(gsh)gsh.onclick=()=>gameMove({action:"show"});
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
// bitirilen eli gruplarına ayırıp küçük bir ıstaka üzerinde göster
function winHandHTML(d,ok){
  const okv={c:ok.c,n:ok.n},h=[...d.winHand];let groups;
  if(d.winKind==="cift"){const k=t=>OK.valueOf(t,okv)==="W"?"W":JSON.stringify(OK.valueOf(t,okv));const by={};h.forEach(t=>(by[k(t)]=by[k(t)]||[]).push(t));
    const w=by.W||[];delete by.W;groups=[];const singles=[];Object.values(by).forEach(g=>{while(g.length>=2)groups.push(g.splice(0,2));if(g.length)singles.push(g[0])});singles.forEach(t=>groups.push([t,w.shift()].filter(x=>x!=null)));while(w.length)groups.push(w.splice(0,2))}
  else{const r=OK.arrange(h,okv);groups=r.rest.length?[...r.groups,r.rest]:r.groups}
  const who=d.winner!=null?seatName(d.seats[d.winner]):"";
  return`<div class="whwrap"><div class="whlbl">${esc(who)} · ${d.winKind==="cift"?"çiftten bitti":"seriden bitti"}</div><div class="wh">${groups.map(g=>`<div class="whg">${g.map(t=>tileHTML(t,ok,{sm:true})).join("")}</div>`).join("")}</div></div>`}
function renderLobby(d,my){
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#gMsg").textContent="";$("#pCtrl").style.display="none";game.pbuilt=false;
  if(d.status==="closed"){$("#gTable").innerHTML='<div class="lobby">Masa kapandı.</div>';return}
  const seats=d.seats.map(s=>`<div class="st">${seatAv(s)}<span>${esc(s?seatName(s):"Boş · bilgisayar oturur")}</span></div>`).join("");
  const host=d.host===me,free=d.seats.some(s=>!s),pool=d.type==="pool"||d.type==="pisti"||d.type==="tavla";
  $("#gTable").innerHTML=`<div class="lobby"><div style="font-size:40px">${gk(d.type)[0]}</div><b style="font-size:20px">${d.type==="pool"?"Bilardo masası · 8 top":d.type==="pisti"?"Pişti masası · 2 kişilik":d.type==="tavla"?"Tavla masası · 2 kişilik":d.type==="batak"?"İhaleli Batak · 4 kişilik":d.type==="kizma"?"Kızma Birader · 4 kişilik":"Okey masası"}</b><div style="opacity:.9;text-align:center">${d.stake?`Masa ücreti <span class="coin"></span> ${fmtCoin(d.stake)}<br><span style="font-size:12.5px">Kazanan potu alır (%5 kesinti). Bilgisayar kazanırsa pot kasaya gider.</span>`:"Ücretsiz masa"}</div><div class="seats">${seats}</div>${my<0?(free?'<button id="gJoin">Masaya otur</button>':'<div>Masa dolu</div>'):host?'<button id="gStart">Oyunu başlat</button><div style="font-size:12.5px;opacity:.8">Boş yerlere bilgisayar oturur</div>':d.public?'<div style="opacity:.85">Oyuncular bekleniyor…</div>':'<div style="opacity:.85">Masa sahibinin başlatması bekleniyor…</div>'}${d.public?'<div id="pubCount" style="font-size:12.5px;opacity:.8"></div>':""}</div>`;
  const j=$("#gJoin");if(j)j.onclick=()=>{if(d.stake&&!wallet?.adult){if(wallet?.ageSet)toast("Jetonlu masalar 18 yaş üstüne açık",3000);else askAge(()=>gameMove({action:"join"}));return}gameMove({action:"join"})};
  const st=$("#gStart");if(st)st.onclick=()=>gameMove({action:"start"});
  if(d.public&&d.status==="lobby"){const lb=$("#gTable .lobby");if(lb&&!$("#gInvite")){const b=document.createElement("button");b.id="gInvite";b.className="ghostbtn";b.textContent="🔗 Davet bağlantısı";lb.appendChild(b);
    b.onclick=()=>{const u=`${location.origin}/?g=${game.id}`,t=`TR'de ${gk(d.type)[1]} masama gel: ${u}`;if(navigator.share)navigator.share({text:t,url:u}).catch(()=>{});else{navigator.clipboard?.writeText(u);toast("Bağlantı kopyalandı")}}}}
}
function rateHTML(d){const my=mySeatIdx(d);if(my<0)return"";const opp=d.seats.filter((x,i)=>x&&!x.bot&&i!==my);if(!opp.length)return"";
  return`<div class="rateb">${opp.map(x=>`<div><span>${esc(seatName(x))}</span><button data-rate="${esc(x.uid)}:1">👍</button><button data-rate="${esc(x.uid)}:-1">👎</button><button data-rrep="${esc(x.uid)}">🚩</button></div>`).join("")}</div>`}
document.addEventListener("click",async e=>{const r=e.target.closest("[data-rate]");if(r&&game){const [to,v]=r.dataset.rate.split(":");r.parentElement.querySelectorAll("button").forEach(b=>b.disabled=true);
    try{await callApi("/api/wallet",{action:"rate",gid:game.id,to,v:+v});toast("Teşekkürler, değerlendirmen kaydedildi")}catch(err){toast(err.status===409?"Zaten değerlendirdin":"Kaydedilemedi")}return}
  const rp=e.target.closest("[data-rrep]");if(rp&&game){openReport(rp.dataset.rrep,"game:"+game.id)}});
function postResult(d){
  try{if(!d||d.status!=="over"||!d.conv||d.host!==me)return;const k="tr-gres-"+game.id+"-"+(d.round||1);if(localStorage.getItem(k))return;localStorage.setItem(k,"1");
    const w=d.winner;const wn=w==null?"":(d.seats[w]&&!d.seats[w].bot?(d.seats[w].uid===me?(users[me]?.nick||"Ben"):realName(d.seats[w].uid)):seatName(d.seats[w]));
    sendContent(d.conv,{t:"gres",kind:d.type||"okey",w:wn,draw:w==null,pot:d.payout&&d.payout.amount||0,gid:game.id})}catch(e){}}
async function gameMove(body){
  if(!game||game.busy)return;const id=game.id;game.busy=true;renderGame();
  const r=await gameApi({...body,id});
  if(game&&game.id===id){game.busy=false;
    if(r&&r.error&&game.pCardOut!=null&&!game.cards.includes(game.pCardOut)){game.cards=[...game.cards,game.pCardOut]}game.pCardOut=null;
    if(r&&r.error&&game.pendingOut!=null){const t=game.pendingOut;game.pendingOut=null;if(game.pendingSlot>=0&&game.slots[game.pendingSlot]==null)game.slots[game.pendingSlot]=t}
    if(r&&r.error==="nowin")toast("El bitmiyor. Taşlar seri ya da çift oluşturmalı.",3000);
    else if(r&&r.error==="balance")toast(r.who&&r.who.includes(me)?"Bakiyen masa ücretine yetmiyor":"Masadaki birinin bakiyesi yetmiyor",3500);
    else if(r&&r.error&&r.error!=="busy")toast("Hamle yapılamadı ("+r.error+")");
    if(body.action==="discard"||body.action==="finish")game.sel=null;
    renderGame();}
}
/* ---------- masa sohbeti ---------- */
const QUICK=["👏","☕ Çay ısmarladım","Selam 👋","İyi oyunlar","Hadi! ⏳","Tebrikler 👏","Şanslısın 😄","Bir dakika","Rövanş? 🔁","😂","👍","🙏"];
$("#gChatQuick").innerHTML=QUICK.map(q=>`<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");
function renderGameChat(){
  if(!game)return;const list=$("#gChatList");
  list.innerHTML=game.chat.length?game.chat.map(m=>`<div class="gm ${m.by===me?"me":""}">${avHTML(m.by)}<div><b>${esc(m.by===me?"Sen":realName(m.by))}</b>${esc(cleanText(m.text))}</div></div>`).join(""):'<div class="isub" style="text-align:center;opacity:.7;margin-top:20px">Masadakilere bir şey yaz ya da hazır mesaj seç</div>';
  list.scrollTop=list.scrollHeight;
  const open=$("#gChat").classList.contains("show");
  if(open)game.chatSeen=Date.now();
  $("#gChatDot").classList.toggle("on",!open&&game.chat.some(m=>m.by!==me&&m.at>game.chatSeen));
}
function fxBurst(emo){const box=document.createElement("div");box.className="fxburst";box.innerHTML=Array.from({length:emo==="👏"?10:5},(_,i)=>`<i style="--x:${Math.random()*80+10}%;--d:${i*90}ms">${emo}</i>`).join("");document.body.appendChild(box);setTimeout(()=>box.remove(),2300)}
function showBubble(m){
  if(m.text==="👏")fxBurst("👏");else if(m.text==="☕ Çay ısmarladım")fxBurst("☕");
  if($("#gChat").classList.contains("show"))return;
  const el=document.createElement("div");el.className="gbub";el.innerHTML=`${avHTML(m.by)}<b>${esc(m.by===me?"Sen":realName(m.by).split(" ")[0])}</b>${esc(cleanText(m.text))}`;
  const box=$("#gBubbles");box.appendChild(el);while(box.children.length>3)box.firstChild.remove();setTimeout(()=>el.remove(),4100);
  if(m.by!==me)sfx("tile");
}
async function sendGameChat(text){
  text=String(text||"").trim().slice(0,120);if(!text||!game)return;
  const d=game.data;if(!d||mySeatIdx(d)<0){toast("Sohbet için masada oturuyor olmalısın");return}
  if(Date.now()-(game.lastChat||0)<1500){toast("Biraz yavaş 🙂");return}game.lastChat=Date.now();
  try{await addDoc(collection(fs,"games",game.id,"chat"),{by:me,text,at:Date.now()})}catch(e){toast("Gönderilemedi")}
}
$("#gChatBtn").onclick=()=>{$("#gChat").classList.add("show");game&&(game.chatSeen=Date.now());renderGameChat();$("#gBubbles").innerHTML=""};
$("#gChatX").onclick=()=>{$("#gChat").classList.remove("show");renderGameChat()};
$("#gChatQuick").onclick=e=>{const b=e.target.closest("[data-q]");if(b){sendGameChat(b.dataset.q)}};
$("#gChatForm").onsubmit=e=>{e.preventDefault();const v=$("#gChatIn").value;$("#gChatIn").value="";sendGameChat(v)};

/* Okey yatay ekranda oynanır: telefon dikse yan çevirme önerisi; tam ekran + yatay kilit denenir */
let landDismissed=false;
function askLandscape(){
  const portrait=window.innerHeight>window.innerWidth&&window.innerWidth<700;
  $("#rotHint").classList.toggle("show",portrait&&!landDismissed);
}
async function goLandscape(){
  try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:"hide"})}catch(e){}
  try{if(screen.orientation&&screen.orientation.lock)await screen.orientation.lock("landscape")}catch(e){}
  setTimeout(()=>{askLandscape();if(game&&game.data)renderGame()},400);
}
function leaveLandscape(){try{screen.orientation&&screen.orientation.unlock&&screen.orientation.unlock()}catch(e){}try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}}
$("#rotGo").onclick=goLandscape;
$("#rotSkip").onclick=()=>{landDismissed=true;askLandscape()};
window.addEventListener("resize",()=>{if(game&&game.data&&(game.data.status==="play"||game.data.status==="over"))askLandscape()});
/* ıstaka: dokun = seç, sürükle = yerini değiştir / at / bitir, çift dokun = at */
const SLOTS=26;
function syncSlots(tiles){
  if(!game.slots||game.slots.length!==SLOTS)game.slots=Array(SLOTS).fill(null);
  if(game.pendingOut!=null)tiles=tiles.filter(t=>t!==game.pendingOut);
  const set=new Set(tiles);
  game.slots=game.slots.map(t=>t!=null&&set.has(t)?t:null);
  const placed=new Set(game.slots.filter(t=>t!=null));
  for(const t of tiles){if(placed.has(t))continue;
    if(game.drawSlot!=null){const ds=game.drawSlot;game.drawSlot=null;
      if(game.slots[ds]==null){game.slots[ds]=t;placed.add(t);continue}
      // dolu yuvaya bırakıldıysa sağa kaydırarak araya sok
      const rowEnd=ds<SLOTS/2?SLOTS/2:SLOTS;let gap=-1;for(let k=ds;k<rowEnd;k++)if(game.slots[k]==null){gap=k;break}
      if(gap>=0){for(let k=gap;k>ds;k--)game.slots[k]=game.slots[k-1];game.slots[ds]=t;placed.add(t);continue}}
    let last=-1;game.slots.forEach((x,i)=>{if(x!=null)last=i});
    let i=game.slots.findIndex((x,k)=>x==null&&k>last);if(i<0)i=game.slots.indexOf(null);
    if(i<0)break;game.slots[i]=t;placed.add(t)}
}
/* desteden / soldan taş çekme: tek dokunuş ya da ıstakaya sürükle-bırak */
let drawDrag=null;
document.addEventListener("pointerdown",e=>{
  const src=e.target.closest("#gPile,#gLeftDisc");if(!src||!game||!game.canDraw||game.busy)return;
  e.preventDefault();const from=src.id==="gPile"?"pile":"left";
  if(from==="left"&&!src.querySelector(".tile:not(.empty)"))return;
  const r=src.getBoundingClientRect();
  drawDrag={from,src,x0:e.clientX,y0:e.clientY,moved:false,ghost:null};
  try{src.setPointerCapture(e.pointerId)}catch(_){}
});
document.addEventListener("pointermove",e=>{const g=drawDrag;if(!g)return;
  if(!g.moved&&Math.hypot(e.clientX-g.x0,e.clientY-g.y0)<8)return;
  if(!g.moved){g.moved=true;const sample=document.querySelector("#gRack .tile:not(.empty)");const w=sample?sample.getBoundingClientRect().width:40,h=sample?sample.getBoundingClientRect().height:56;
    const top=g.from==="left"?g.src.querySelector(".st:last-child .tile"):null;
    g.ghost=top?top.cloneNode(true):document.createElement("div");if(!top)g.ghost.className="tile back";
    g.ghost.classList.add("ghost");Object.assign(g.ghost.style,{width:w+"px",height:h+"px",fontSize:sample?getComputedStyle(sample).fontSize:"",paddingTop:sample?getComputedStyle(sample).paddingTop:""});
    g.w=w;g.h=h;document.body.appendChild(g.ghost);sfx("tile")}
  g.ghost.style.transform=`translate(${e.clientX-g.w/2}px,${e.clientY-g.h/2}px) scale(1.1)`;
  document.querySelectorAll(".hov").forEach(x=>x.classList.remove("hov"));
  g.ghost.style.display="none";const el=document.elementFromPoint(e.clientX,e.clientY);g.ghost.style.display="";
  const sl=el&&el.closest("#gRack .slot");if(sl)sl.classList.add("hov");
});
function endDrawDrag(e,cancel){const g=drawDrag;drawDrag=null;if(!g)return;
  document.querySelectorAll(".hov").forEach(x=>x.classList.remove("hov"));
  let slot=null;
  if(g.ghost){g.ghost.style.display="none";const el=document.elementFromPoint(e.clientX,e.clientY);g.ghost.remove();const sl=el&&el.closest("#gRack .slot");if(sl)slot=+sl.dataset.slot;
    if(cancel||slot==null)return}
  if(cancel)return;
  game.drawSlot=slot;gameMove({action:"draw",from:g.from});
}
document.addEventListener("pointerup",e=>endDrawDrag(e,false));
document.addEventListener("pointercancel",e=>endDrawDrag(e,true));
let rackDrag=null,lastTap={t:null,at:0};
$("#gRack").addEventListener("pointerdown",e=>{
  const el=e.target.closest(".tile");if(!el||!game||el.closest(".tile.empty"))return;
  e.preventDefault();const t=+el.dataset.t;const r=el.getBoundingClientRect();
  rackDrag={t,el,x0:e.clientX,y0:e.clientY,dx:e.clientX-r.left,dy:e.clientY-r.top,w:r.width,h:r.height,moved:false,ghost:null,pid:e.pointerId};
  try{el.setPointerCapture(e.pointerId)}catch(_){}
});
$("#gRack").addEventListener("pointermove",e=>{
  const g=rackDrag;if(!g)return;
  if(!g.moved&&Math.hypot(e.clientX-g.x0,e.clientY-g.y0)<7)return;
  if(!g.moved){g.moved=true;g.ghost=g.el.cloneNode(true);g.ghost.classList.add("ghost");g.ghost.classList.remove("sel","new");
    Object.assign(g.ghost.style,{width:g.w+"px",height:g.h+"px",fontSize:getComputedStyle(g.el).fontSize,paddingTop:getComputedStyle(g.el).paddingTop});
    g.ghost.querySelector("i")&&Object.assign(g.ghost.querySelector("i").style,{width:(g.w*.34)+"px",marginTop:(g.w*.09)+"px"});document.body.appendChild(g.ghost);g.el.classList.add("lifting");sfx("tile")}
  g.ghost.style.transform=`translate(${e.clientX-g.dx}px,${e.clientY-g.dy}px) scale(1.12)`;
  document.querySelectorAll(".hov").forEach(x=>x.classList.remove("hov"));
  const tgt=dropTarget(e.clientX,e.clientY);if(tgt)tgt.classList.add("hov");
});
function dropTarget(x,y){
  if(rackDrag&&rackDrag.ghost)rackDrag.ghost.style.display="none";
  const el=document.elementFromPoint(x,y);
  if(rackDrag&&rackDrag.ghost)rackDrag.ghost.style.display="";
  if(!el)return null;
  return el.closest(".slot")||(game.canDiscard?el.closest("#gDropDiscard,#gDropFinish"):null);
}
function endRackDrag(e,cancel){
  const g=rackDrag;rackDrag=null;if(!g)return;
  document.querySelectorAll(".hov").forEach(x=>x.classList.remove("hov"));
  if(g.ghost)g.ghost.remove();g.el.classList.remove("lifting");
  if(cancel)return;
  if(!g.moved){
    const now=Date.now();
    if(lastTap.t===g.t&&now-lastTap.at<330&&game.canDiscard){lastTap={t:null,at:0};discardTile(g.t);return}
    lastTap={t:g.t,at:now};
    game.sel=game.sel===g.t?null:g.t;game.newTiles=null;renderGame();return;
  }
  const tgt=dropTarget(e.clientX,e.clientY);if(!tgt){renderGame();return}
  if(tgt.id==="gDropDiscard"){discardTile(g.t);return}
  if(tgt.id==="gDropFinish"){game.sel=g.t;gameMove({action:"finish",tile:g.t});return}
  const to=+tgt.dataset.slot,from=game.slots.indexOf(g.t);
  if(from<0||to===from){renderGame();return}
  // hedef doluysa: taşları kaydırarak araya sok (aynı kat içinde), olmazsa yer değiştir
  const s=game.slots;
  if(s[to]==null){s[to]=g.t;s[from]=null}
  else{const rowEnd=to<SLOTS/2?SLOTS/2:SLOTS;let gap=-1;for(let k=to;k<rowEnd;k++)if(s[k]==null||k===from){gap=k;break}
    if(gap>=0&&(from<to||from>=rowEnd||from<(to<SLOTS/2?0:SLOTS/2))){s[from]=null;for(let k=gap;k>to;k--)s[k]=s[k-1];s[to]=g.t}
    else{s[from]=s[to];s[to]=g.t}}
  game.sel=null;game.newTiles=null;sfx("tile");renderGame();
}
$("#gRack").addEventListener("pointerup",e=>endRackDrag(e,false));
$("#gRack").addEventListener("pointercancel",e=>endRackDrag(e,true));
function discardTile(t){
  if(!game||!game.canDiscard||game.busy)return;
  // anında göster, sunucu onaylayınca kesinleşir
  const i=game.slots.indexOf(t);if(i>=0)game.slots[i]=null;
  game.pendingOut=t;game.pendingSlot=i;game.sel=null;sfx("tile");
  gameMove({action:"discard",tile:t});
}
/* ---------- oyunlar: Bilardo (8 top) ---------- */
// Vuruş sunucuda simüle edilir. İstemci aynı fizik koduyla vuruşları tekrar oynatır (animasyon), sonra sunucunun sonucuna oturur.
const BALL_COL=["#fff","#F2C200","#1E4FD8","#D7261E","#5B2A86","#F07A12","#127A3A","#7A1B1B","#111"];
const FELT_COL={yesil:"#0f6b3a",lacivert:"#1d3d7a",bordo:"#7a1a28",siyah:"#2e2e2e",ay:"#b30f27",vip_mor:"#4d1c70",vip_mermer:"#5d7a8c",vip_altin:"#1b4a32"};
const RAIL_COL={ceviz:"#6b4423",abanoz:"#2a1c14",kiraz:"#7a2a22",altin:"#c79a2a",vip_sedef:"#d9cfc2",vip_elmas:"#7fb8dc"};
const GROUP_TR={solid:"düz",stripe:"çizgili"};
/* ---------- Pişti ---------- */
const P_SUITS=["♠","♥","♦","♣"],P_RANKS=["","A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const pRank=c=>c%13+1,pSuit=c=>Math.floor(c/13);
function cardHTML(c,{cls="",back=false}={}){
  if(back||c==null)return`<div class="pcard back ${cls}"></div>`;
  const su=pSuit(c),r=P_RANKS[pRank(c)],red=su===1||su===2;
  return`<div class="pcard ${red?"red":""} ${cls}" data-c="${c}"><span class="tl">${r}<br>${P_SUITS[su]}</span><span class="mid${pRank(c)>10?" face":""}">${pRank(c)>10?r+"<small style='font-size:.55em'>"+P_SUITS[su]+"</small>":P_SUITS[su]}</span><span class="br">${r}<br>${P_SUITS[su]}</span></div>`}
function renderPisti(d,my){
  $("#gTitleTxt").textContent="Pişti";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. el`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#pCtrl").style.display="none";$("#gMsg").textContent="";
  const me2=my>=0?my:0,op=1-me2,isMy=d.status==="play"&&d.turn===my&&!game.busy;
  const hc=d.handCounts||[0,0],tk=d.takenN||[0,0],pi=d.pisti||[0,0];
  const side=(i,top)=>`<div class="pside ${top?"top":"bot"} ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(d.seats[i])}<div class="pinfo"><b>${esc(seatName(d.seats[i]))}${d.seats[i]&&!d.seats[i].bot?vipMark(d.seats[i].uid):""}</b><span>🂠 ${tk[i]} kart${pi[i]?` · <em>${pi[i]/10>=1?"PİŞTİ "+pi[i]:""}</em>`:""} · ${(d.scores||[])[i]||0}🏆</span></div></div>`;
  const opp=`<div class="phand opp">${Array.from({length:hc[op]||0},()=>cardHTML(null,{back:true})).join("")}</div>`;
  const pileN=d.pileN||0;const lk=d.last?d.last.at+"-"+d.last.seat:"";const pNew=lk&&game.pLastK!==lk;game.pLastK=lk;
  const stack=pileN?`${pileN>2?`<div class="pcard back st3"></div>`:""}${pileN>1?(d.under!=null?cardHTML(d.under,{cls:"st2"}):`<div class="pcard back st2"></div>`):""}${cardHTML(d.top,{cls:"st1 "+(d.last&&d.last.card===d.top&&!d.last.captured?(pNew&&d.last.seat!==me2?"land opl":"land"):"")})}`:`<div class="pempty ${pNew&&d.last&&d.last.seat!==me2?"late":""}">${d.last&&d.last.captured?(d.last.pisti?"PİŞTİ!":"Alındı"):"Yer boş"}</div>`;
  const deck=d.deckN?`<div class="pdeck"><div class="pcard back"></div><span>${d.deckN}</span></div>`:`<div class="pdeck empty"><span>Deste bitti</span></div>`;
  const mine=(game.cards||[]).slice().sort((a,b)=>(pSuit(a)-pSuit(b))||(pRank(a)-pRank(b)));
  const hand=`<div class="phand me ${isMy?"can":""}">${mine.map(c=>cardHTML(c,{cls:"mine"})).join("")}</div>`;
  const flash=d.last&&d.last.pisti&&Date.now()-(d.last.at||0)<4000?`<div class="pflash">${d.last.pisti===20?"VALE İLE PİŞTİ! +20":"PİŞTİ! +10"}</div>`:"";
  let over="";
  if(d.status==="over"&&d.final){const f=d.final,w=d.winner;
    over=`<div class="overlay2"><div class="overbox"><b style="font-size:18px">${w==null?"Berabere":w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}</b>
      <table class="pfin"><tr><th></th><th>${esc(seatName(d.seats[me2]))}</th><th>${esc(seatName(d.seats[op]))}</th></tr>
      <tr><td>Kart</td><td>${f.cards[me2]}</td><td>${f.cards[op]}</td></tr><tr><td>Pişti</td><td>${f.pisti[me2]}</td><td>${f.pisti[op]}</td></tr>
      <tr><td><b>Puan</b></td><td><b>${f.pts[me2]}</b></td><td><b>${f.pts[op]}</b></td></tr></table>
      ${d.payout?(d.payout.refund?`<div>Berabere: masa ücretleri iade edildi</div>`:d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}</div>`):""}
      ${d.host===me?`<button id="gAgain">Yeni el</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni eli masa sahibi başlatır</div>`}</div></div>`}
  $("#gTable").innerHTML=`<div class="ptable">${side(op,true)}${opp}<div class="pcenter">${deck}<div class="ppile">${stack}</div></div>${flash}<div class="plog">${esc(d.status==="play"?(isMy?"Sıra sende · bir kart seç":d.turn===my?"…":esc(seatName(d.seats[d.turn]))+" düşünüyor…"):"")}${d.log&&d.status==="play"?`<small>${esc(d.log)}</small>`:""}</div>${hand}${side(me2,false)}${over}</div>`;
  const hb=$(".phand.me");if(hb)hb.onclick=e=>{const c=e.target.closest(".pcard[data-c]");if(!c||!isMy)return;const v=+c.dataset.c;
    c.classList.add("go");game.pCardOut=v;game.cards=(game.cards||[]).filter(x=>x!==v);setTimeout(()=>gameMove({action:"play",card:v}),320)};
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
/* ---------- Kızma Birader ---------- */
const KZ_PATH=(()=>{const p=[];for(let c=0;c<=4;c++)p.push([4,c]);for(let r=3;r>=0;r--)p.push([r,4]);p.push([0,5]);for(let r=0;r<=4;r++)p.push([r,6]);for(let c=7;c<=10;c++)p.push([4,c]);p.push([5,10]);for(let c=10;c>=6;c--)p.push([6,c]);for(let r=7;r<=10;r++)p.push([r,6]);p.push([10,5]);for(let r=10;r>=6;r--)p.push([r,4]);for(let c=3;c>=0;c--)p.push([6,c]);p.push([5,0]);return p})();
const KZ_FIN=[[[5,1],[5,2],[5,3],[5,4]],[[1,5],[2,5],[3,5],[4,5]],[[5,9],[5,8],[5,7],[5,6]],[[9,5],[8,5],[7,5],[6,5]]];
const KZ_HOME=[[[0,0],[0,1],[1,0],[1,1]],[[0,9],[0,10],[1,9],[1,10]],[[9,9],[9,10],[10,9],[10,10]],[[9,0],[9,1],[10,0],[10,1]]];
const KZ_COL=["#e53935","#1e88e5","#43a047","#fdd835"],KZ_NAME=["Kırmızı","Mavi","Yeşil","Sarı"];
function kzMoves(kz,p,d){const P=kz.pos[p]||kz.pos[String(p)]||[],out=[];for(let k=0;k<4;k++){const r=P[k];let to;if(r===-1){if(d!==6)continue;to=0}else{to=r+d;if(to>43)continue}if(P.some((x,j)=>j!==k&&x===to))continue;out.push({k,to})}return out}
function renderKizma(d,my){
  $("#gTitleTxt").textContent="Kızma Birader";$("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. oyun`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#pCtrl").style.display="none";$("#gMsg").textContent="";
  // zar elle atılır: sıra sende olunca "Zar at" düğmesine bas (sonuç sunucuda belirlenir)
  const kdk=d.seq+"-"+d.turn,needRoll=d.status==="play"&&d.turn===my&&!!d.die&&game.kzRolled!==kdk;
  const isMy=d.status==="play"&&d.turn===my&&!game.busy&&!needRoll,mv=isMy&&d.die?kzMoves(d.kz,my,d.die):[],mk=new Set(mv.map(m=>m.k));
  const cell={};const put=(rc,h)=>{cell[rc[0]+"_"+rc[1]]=(cell[rc[0]+"_"+rc[1]]||"")+h};
  for(let p=0;p<4;p++){const P=d.kz.pos[p]||d.kz.pos[String(p)]||[];P.forEach((r,k)=>{const rc=r===-1?KZ_HOME[p][k]:r>=40?KZ_FIN[p][r-40]:KZ_PATH[(p*10+r)%40];
    put(rc,`<i class="kzp ${p===my&&mk.has(k)?"can":""}" style="--c:${KZ_COL[p]}" ${p===my&&mk.has(k)?`data-kzk="${k}"`:""}></i>`)})}
  const kind={};KZ_PATH.forEach((rc,i)=>{kind[rc[0]+"_"+rc[1]]=i%10===0?"st s"+(i/10):"tr"});KZ_FIN.forEach((f,p)=>f.forEach(rc=>kind[rc[0]+"_"+rc[1]]="fin f"+p));KZ_HOME.forEach((h,p)=>h.forEach(rc=>kind[rc[0]+"_"+rc[1]]="home h"+p));
  let grid="";for(let r=0;r<11;r++)for(let c=0;c<11;c++){const k=r+"_"+c;grid+=`<div class="kzc ${kind[k]||"x"}">${cell[k]||""}</div>`}
  const PIP={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const die=needRoll?`<button class="kzroll" id="kzRoll">🎲 Zar at</button>`:d.die?`<span class="die ${game.kzSeq!==d.seq||game.kzJust?"roll":""}">${Array.from({length:9},(_,k)=>`<i class="${PIP[d.die].includes(k)?"on":""}"></i>`).join("")}</span>`:"";if(!needRoll){game.kzSeq=d.seq;game.kzJust=false}
  const sides=d.seats.map((s,i)=>`<div class="kzs ${d.status==="play"&&d.turn===i?"turn":""}" style="--c:${KZ_COL[i]}"><i></i>${esc(seatName(s))}</div>`).join("");
  let over="";if(d.status==="over"){const w=d.winner;over=`<div class="overbox"><b style="font-size:18px">${w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}</b>${d.payout?(d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton</div>`):""}${rateHTML(d)}${d.host===me?`<button id="gAgain">Yeni oyun</button>`:""}</div>`}
  $("#gTable").innerHTML=`<div class="kztable"><div class="kzside">${sides}</div><div class="kzboard">${grid}</div><div class="kzctl">${die}<div class="thint">${d.status!=="play"?"":needRoll?"Sıra sende · zarı at":isMy?(mv.length?"Parlayan piyonlardan birini seç":"…"):esc(seatName(d.seats[d.turn]))+" oynuyor…"}<small>${esc(d.log||"")}</small></div></div>${over}</div>`;
  $("#gTable .kzboard").onclick=e=>{const b=e.target.closest("[data-kzk]");if(!b||!isMy)return;gameMove({action:"move",k:+b.dataset.kzk})};
  const kr=$("#kzRoll");if(kr)kr.onclick=()=>{game.kzRolled=kdk;game.kzJust=true;sfx("tile");renderGame()};
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
/* ---------- Batak ---------- */
const BK_S=["♠","♥","♦","♣"],bkVal=c=>c%13===0?14:c%13+1;
function bkLegal(hand,trick,trump,broken){const su=c=>Math.floor(c/13);
  if(!trick.length){if(trump==null||broken)return hand;const n=hand.filter(c=>su(c)!==trump);return n.length?n:hand}
  const lead=su(trick[0].c);let w=trick[0];for(const t of trick.slice(1)){const ws=su(w.c),ts=su(t.c);if(ts===ws&&bkVal(t.c)>bkVal(w.c))w=t;else if(trump!=null&&ts===trump&&ws!==trump)w=t}
  const f=hand.filter(c=>su(c)===lead);if(f.length){if(su(w.c)!==lead)return f;const h=f.filter(c=>bkVal(c)>bkVal(w.c));return h.length?h:f}
  const tr=trump==null?[]:hand.filter(c=>su(c)===trump);if(tr.length){if(su(w.c)===trump){const h=tr.filter(c=>bkVal(c)>bkVal(w.c));return h.length?h:tr}return tr}return hand}
function renderBatak(d,my){
  $("#gTitleTxt").textContent="Batak";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. el${d.trump!=null?" · koz "+BK_S[d.trump]:""}${d.bid?" · ihale "+d.bid:""}`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  askLandscape();
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#pCtrl").style.display="none";$("#gMsg").textContent="";
  const me4=my>=0?my:0,pos=i=>["bottom","right","top","left"][(i-me4+4)%4],isMy=d.status==="play"&&d.turn===my&&!game.busy;
  const hc=d.handCounts||[0,0,0,0],tk=d.tricks||[0,0,0,0],bids=d.bids||[];
  const seatBox=i=>`<div class="bkseat bk-${pos(i)} ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(d.seats[i])}<div><b>${esc(seatName(d.seats[i]))}${d.bidder===i?" 🎯":""}</b><span>${d.phase==="bid"?(bids[i]==null?"…":bids[i]?bids[i]+" dedi":"pas"):`${tk[i]} el`}${pos(i)!=="bottom"?` · 🂠 ${hc[i]}`:""} · ${(d.scores||[])[i]||0}p</span></div></div>`;
  // kartlar tek tek, gerçekçi hızda düşer; biten el bir süre masada kalır
  const ltK=d.lastTrick?"l"+d.lastTrick.at:"";
  if(ltK&&game.bkLtK!==ltK){const seen=game.bkLtK===undefined?d.lastTrick.cards.length:(game.bkSeenK&&game.bkSeenK[0]==="t"?game.bkSeenN:0);game.bkLtK=ltK;game.bkLtSeen=seen;game.bkLtUntil=Date.now()+1900+Math.max(0,d.lastTrick.cards.length-seen)*650}
  const inLast=!!d.lastTrick&&Date.now()<(game.bkLtUntil||0);
  const showTrick=inLast?d.lastTrick.cards:(d.trick||[]);
  const tkey=inLast?ltK:"t"+d.round+"-"+(d.tricks||[]).reduce((a,b)=>a+b,0);
  const seenN=inLast?(game.bkSeenK===tkey?game.bkSeenN:game.bkLtSeen):(game.bkSeenK===tkey?game.bkSeenN:0);
  game.bkSeenK=tkey;game.bkSeenN=showTrick.length;
  const center=`<div class="bkcenter">${showTrick.map((t,i)=>`<div class="bkc bkc-${pos(t.p)}">${cardHTML(t.c,{cls:i>=seenN?"fly":""}).replace('class="pcard','style="animation-delay:'+(Math.max(0,i-seenN)*0.65)+'s" class="pcard')}</div>`).join("")}${d.trump!=null?`<div class="bktrump ${d.trump===1||d.trump===2?"red":""}">${BK_S[d.trump]}<small>koz</small></div>`:""}</div>`;
  const mine=(game.cards||[]).slice().sort((a,b)=>(Math.floor(a/13)-Math.floor(b/13))||(bkVal(a)-bkVal(b)));
  const legal=isMy&&d.phase==="play"&&!inLast?new Set(bkLegal(mine,d.trick||[],d.trump,d.broken)):new Set();
  const hand=`<div class="bkhand">${mine.map(c=>cardHTML(c,{cls:legal.has(c)?"ok":isMy&&d.phase==="play"?"no":""})).join("")}</div>`;
  let ctrl="";
  if(isMy&&d.phase==="bid"){const min=Math.max(4,(d.bid||0)+1);ctrl=`<div class="bkctl"><b>İhale${d.bid?` (en yüksek: ${d.bid})`:""}</b><div>${Array.from({length:Math.max(0,14-min)},(_,k)=>`<button data-bid="${min+k}">${min+k}</button>`).join("")}<button data-bid="0" class="pas">Pas</button></div></div>`}
  else if(isMy&&d.phase==="trump")ctrl=`<div class="bkctl"><b>Kozu seç (ihale ${d.bid})</b><div>${BK_S.map((x,i)=>`<button data-trump="${i}" class="${i===1||i===2?"red":""}" style="font-size:24px">${x}</button>`).join("")}</div></div>`;
  let over="";
  if(d.status==="over"&&d.final){const f=d.final,w=d.winner;
    over=`<div class="overbox"><b style="font-size:18px">${w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}</b><div>${esc(d.log||"")}</div>
      <table class="pfin"><tr><th></th><th>El</th><th>Puan</th></tr>${d.seats.map((x,i)=>`<tr><td>${esc(seatName(x))}${f.bidder===i?" 🎯"+f.bid:""}</td><td>${f.tricks[i]}</td><td><b>${f.pts[i]>0?"+":""}${f.pts[i]}</b></td></tr>`).join("")}</table>
      ${d.payout?(d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:d.payout.refund?"":`<div><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton</div>`):""}${rateHTML(d)}
      ${d.host===me?`<button id="gAgain">Yeni el</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni eli masa sahibi başlatır</div>`}</div>`}
  const msg=d.status!=="play"?"":isMy?(d.phase==="bid"?"İhale sırası sende":d.phase==="trump"?"Kozu seç":"Kart at"):`${esc(seatName(d.seats[d.turn]))} ${d.phase==="bid"?"ihale düşünüyor…":d.phase==="trump"?"kozu seçiyor…":"oynuyor…"}`;
  $("#gTable").innerHTML=`<div class="bktable">${d.seats.map((_,i)=>seatBox(i)).join("")}${center}<div class="bkmsg">${msg}<small>${esc(d.log||"")}</small></div>${ctrl}${hand}${over}</div>`;
  const bt=$("#gTable .bktable");bt.onclick=e=>{const b=e.target.closest("[data-bid]");if(b){gameMove({action:"bid",v:+b.dataset.bid});return}
    const t=e.target.closest("[data-trump]");if(t){gameMove({action:"trump",suit:+t.dataset.trump});return}
    const c=e.target.closest(".bkhand .pcard[data-c]");if(c&&legal.has(+c.dataset.c)){const v=+c.dataset.c;c.classList.add("go");game.pCardOut=v;game.cards=(game.cards||[]).filter(x=>x!==v);setTimeout(()=>gameMove({action:"play",card:v}),300)}};
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
  if(inLast){clearTimeout(game.bkT);game.bkT=setTimeout(()=>{if(game&&game.data===d)renderGame()},game.bkLtUntil-Date.now()+50)}
}
/* ---------- Tavla ---------- */
function tvLegal(d,my){const key=JSON.stringify([d.seq,d.dice]);if(game.tvKey!==key){game.tvKey=key;game.tvSeqs=d.dice?TV.sequences(TV.rel(d.tv,my),d.dice):[[]]}return game.tvSeqs}
function tvNext(d,my){const path=game.tvPath||[],seqs=tvLegal(d,my);const k=m=>m.from+">"+m.to;
  const pre=seqs.filter(q=>q.length>path.length&&path.every((m,i)=>k(q[i])===k(m)));return{next:pre.map(q=>q[path.length]),done:path.length>0&&!pre.length}}
function renderTavla(d,my){
  $("#gTitleTxt").textContent="Tavla";
  $("#gSub").textContent=d.status==="lobby"?"Oyuncular bekleniyor":d.round?`${d.round}. oyun · skor ${(d.scores||[0,0])[my>=0?my:0]}-${(d.scores||[0,0])[my>=0?1-my:1]}`:"";
  $("#gLeave").style.display=my>=0&&d.status!=="over"?"":"none";
  if(d.status==="lobby"||d.status==="closed")return renderLobby(d,my);
  $("#gRack").style.display="none";$("#gActions").style.display="none";$("#pCtrl").style.display="none";$("#gMsg").textContent="";
  const me2=my>=0?my:0,op=1-me2;
  // zar: otomatik ya da elle atılır (sonuç sunucuda belirlenir, burada gösterilir)
  const tmode=localStorage.getItem("tr-tvmode")||"auto",dkey=d.seq+"-"+d.turn;
  let needRoll=false,animDice=false;
  if(d.status==="play"&&d.dice){
    if(d.turn===my){if(game.tvRolled!==dkey){if(tmode==="auto"){game.tvRolled=dkey;animDice=true}else needRoll=true}}
    else if(game.tvSeen!==dkey){game.tvSeen=dkey;animDice=true}}
  const isMy=d.status==="play"&&d.turn===my&&!game.busy&&!needRoll;
  game.tvPath=game.tvPath||[];
  let r=TV.rel(d.tv,me2);for(const m of game.tvPath)r=TV.applyRel(r,m);
  const nx=isMy?tvNext(d,my):{next:[],done:false};
  const srcs=new Set(nx.next.map(m=>m.from)),tgts=new Set(nx.next.filter(m=>m.from===game.tvSel).map(m=>m.to));
  const chk=(n,mine)=>{const a=Math.abs(n),show=Math.min(a,5);return Array.from({length:show},(_,i)=>`<i class="ck ${mine?"w":"b"}">${i===show-1&&a>5?a:""}</i>`).join("")};
  const pt=(i,top,col)=>{const v=r.b[i];return`<div style="grid-column:${col}" class="tp ${top?"t":"u"} ${(i%2)^(top?1:0)?"d":"l"} ${srcs.has(i)&&game.tvSel==null?"src":""} ${game.tvSel===i?"sel":""} ${tgts.has(i)?"tgt":""}" data-p="${i}">${v?chk(v,v>0):""}</div>`};
  const row=(arr,top,c0)=>arr.map((i,k)=>pt(i,top,c0+k)).join("");
  const bar=`<div class="tvbar"><div class="bo">${r.obar?chk(-r.obar,false):""}</div><div class="bm ${srcs.has(24)&&game.tvSel==null?"src":""} ${game.tvSel===24?"sel":""}" data-p="24">${r.bar?chk(r.bar,true):""}</div></div>`;
  const offT=`<div class="toff"><div class="oo"><b>${d.tv.off[op]}</b><span>${Array.from({length:Math.min(d.tv.off[op],15)},()=>'<u class="b"></u>').join("")}</span></div><div class="om ${tgts.has(-1)?"tgt":""}" data-p="-1"><span>${Array.from({length:Math.min(r.off,15)},()=>'<u class="w"></u>').join("")}</span><b>${r.off}</b></div></div>`;
  const usedN=game.tvPath.length,dice=d.dice||[];const dl=dice.length?(dice[0]===dice[1]?[dice[0],dice[0],dice[0],dice[0]]:dice):[];
  const usedVals=game.tvPath.map(m=>m.d);const dUsed=dl.map(()=>false);usedVals.forEach(v=>{const k=dl.findIndex((x,i)=>x===v&&!dUsed[i]);if(k>=0)dUsed[k]=true});
  const pipsTxt=`${TV.pips(d.tv,me2)} / ${TV.pips(d.tv,op)}`;
  const PIP={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const dieH=(v,used,hide)=>`<span class="die ${used?"used":""} ${animDice?"roll":""}">${Array.from({length:9},(_,k)=>`<i class="${!hide&&PIP[v]&&PIP[v].includes(k)?"on":""}"></i>`).join("")}</span>`;
  const side=(i,top)=>`<div class="pside ${top?"top":"bot"} ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(d.seats[i])}<div class="pinfo"><b>${esc(seatName(d.seats[i]))}${d.seats[i]&&!d.seats[i].bot?vipMark(d.seats[i].uid):""}</b><span>${i===me2?"⚪ beyaz":"⚫ siyah"} · ${(d.scores||[])[i]||0} sayı</span></div></div>`;
  let over="";
  if(d.status==="over"){const w=d.winner;over=`<div class="overbox"><b style="font-size:18px">${w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}${d.mars?" · MARS!":""}</b><div style="font-size:13px;opacity:.85">Skor ${(d.scores||[0,0])[me2]} - ${(d.scores||[0,0])[op]}</div>
    ${d.payout?(d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}</div>`):""}
    ${d.host===me?`<button id="gAgain">Yeni oyun</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni oyunu masa sahibi başlatır</div>`}</div>`}
  const hint=d.status!=="play"?"":isMy?(game.tvSel==null?(nx.next.length?"Oynatacağın pulu seç":""):"Gideceği haneyi seç"):esc(seatName(d.seats[d.turn]))+" oynuyor…";
  $("#gTable").innerHTML=`<div class="ttable">${side(op,true)}
    <div class="tboard"><div class="trow top">${row([12,13,14,15,16,17],true,1)}</div><div class="trow top r">${row([18,19,20,21,22,23],true,8)}</div>${bar}
      <div class="trow bot">${row([11,10,9,8,7,6],false,1)}</div><div class="trow bot r">${row([5,4,3,2,1,0],false,8)}</div>${offT}
      ${dl.length||needRoll?`<div class="tbdice ${d.turn===my?"r":"l"} ${animDice?"throw":""}">${(needRoll?[]:dl.slice(0,dice[0]===dice[1]?4:2)).map((v,i)=>dieH(v,!needRoll&&dUsed[i],false)).join("")}</div>`:""}</div>
    <div class="tctl">
      ${needRoll?`<button id="tRoll">🎲 Zar at</button>`:`<div class="thint">${hint}<small>${esc(d.log||"")} · pip ${pipsTxt}</small></div>`}${isMy&&usedN?`<button id="tUndo">↶ Geri al</button>`:""}
      ${my>=0?`<div class="tmode"><button data-tm="auto" class="${tmode==="auto"?"on":""}">Otomatik zar</button><button data-tm="manual" class="${tmode==="manual"?"on":""}">Elle zar at</button></div>`:""}</div>
    ${side(me2,false)}${over}</div>`;
  const bd=$(".tboard");if(bd)bd.onclick=e=>{if(!isMy)return;const el=e.target.closest("[data-p]");if(!el)return;const p=+el.dataset.p;
    if(game.tvSel!=null&&tgts.has(p)){const m=nx.next.find(x=>x.from===game.tvSel&&x.to===p);game.tvPath=[...game.tvPath,m];game.tvSel=null;sfx("tile");tvAfter(d,my);return}
    if(srcs.has(p)){const ts=[...new Set(nx.next.filter(m=>m.from===p).map(m=>m.to))];
      if(ts.length===1){game.tvPath=[...game.tvPath,nx.next.find(m=>m.from===p)];game.tvSel=null;sfx("tile");tvAfter(d,my);return}
      game.tvSel=game.tvSel===p?null:p;renderGame();return}
    game.tvSel=null;renderGame()};
  const u=$("#tUndo");if(u)u.onclick=()=>{game.tvPath=game.tvPath.slice(0,-1);game.tvSel=null;renderGame()};
  const rb=$("#tRoll");if(rb)rb.onclick=()=>{game.tvRolled=dkey;sfx("ball");renderGame();setTimeout(()=>sfx("ball"),200)};
  document.querySelectorAll(".tmode [data-tm]").forEach(b=>b.onclick=()=>{localStorage.setItem("tr-tvmode",b.dataset.tm);if(b.dataset.tm==="auto"&&d.turn===my)game.tvRolled=dkey;renderGame()});
  if(animDice)setTimeout(()=>sfx("ball"),80);
  const ag=$("#gAgain");if(ag)ag.onclick=()=>gameMove({action:"again"});
}
function tvAfter(d,my){const nx=tvNext(d,my);
  if(nx.done){const seq=game.tvPath.map(m=>({from:m.from,to:m.to}));game.tvPath=[];gameMove({action:"move",seq}).then(()=>{if(game)renderGame()});return}
  renderGame()}
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
  const onT=new Set((game.pview||d.balls||[]).map(b=>b.i));
  const mini=i=>{const col=BALL_COL[i>8?i-8:i];return`<i class="mb ${onT.has(i)?"":"gone"} ${i>8?"st":""}" style="--c:${col}"></i>`};
  const balls=k=>k?`<div class="mbs">${(k==="solid"?[1,2,3,4,5,6,7]:[9,10,11,12,13,14,15]).map(mini).join("")}${mini(8)}</div>`:'<div class="mbs q">Grup ilk sokan topla belli olur</div>';
  $("#pBar").innerHTML=d.seats.map((s,i)=>`<div class="pp ${d.status==="play"&&d.turn===i?"turn":""}">${seatAv(s)}<div class="ppi"><b>${esc(seatName(s))}${s&&!s.bot?vipMark(s.uid):""} <small>${(d.scores||[])[i]||0}🏆</small></b>${balls(g&&g[i])}</div></div>`).join('<div class="vs">VS</div>');
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
    $("#pCtrl").style.display="";$("#pCtrl").style.visibility=myTurn&&d.status==="play"?"visible":"hidden";
    $("#gamescr").classList.toggle("myturn",myTurn&&!game.busy);
    let msg="";
    if(d.status==="play"){
      if(my<0)msg="İzliyorsun";
      else if(myTurn)msg=game.place?"Beyaz topu sürükleyip yerleştir, sonra nişan al":"Sıra sende: parmağını kaydırıp nişan al, sağdaki ıstakayı çekip bırak";
      else msg=`${esc(seatName(d.seats[d.turn]))} oynuyor…`;
      if(d.log)msg=`<span style="opacity:.8;font-weight:500">${esc(d.log)}</span><br>`+msg;
    }
    $("#gMsg").innerHTML=msg;
    const ov=$("#pOver");
    if(d.status==="over"){
      const w=d.winner;
      ov.innerHTML=`<div class="overbox"><b style="font-size:18px">${w==null?"Oyun yarım kaldı":w===my?"🎉 Kazandın!":esc(seatName(d.seats[w]))+" kazandı"}</b><div style="font-size:13px;opacity:.85">${esc(d.log||"")}</div>${d.payout?(d.payout.house?`<div>Bilgisayar kazandı, pot kasaya gitti</div>`:`<div style="font-size:16px"><span class="coin"></span> +${fmtCoin(d.payout.amount)} jeton ${d.payout.uid===me?"senin!":""}</div><div style="font-size:11.5px;opacity:.75">%5 kesinti: ${fmtCoin(d.payout.rake||0)}</div>`):""}<div class="sc">${d.seats.map((s,i)=>`<span>${esc(seatName(s))}: <b>${(d.scores||[])[i]||0}</b></span>`).join("")}</div>${d.host===me?`<button id="gAgain">Yeni oyun</button>`:`<div style="font-size:12.5px;opacity:.8">Yeni oyunu masa sahibi başlatır</div>`}</div>`;
      const ag=$("#gAgain");if(ag)ag.onclick=()=>{game.aim=null;gameMove({action:"again"})};
      $("#pCtrl").style.visibility="hidden";$("#gamescr").classList.remove("myturn");
    }else ov.innerHTML="";
    drawPool();
  }
}
function findSpot(others,kitchen){for(const [x,y] of [[200,250],[150,250],[200,150],[200,350],[100,250],[500,250]])if(P.canPlace(others,x,y,kitchen))return{x,y};return{x:120,y:250}}
function curCue(){const d=game.data;if(game.place)return game.place;return(game.pview||d.balls||[]).find(b=>b.i===0)||null}
function poolBalls(){const d=game.data;let bs=(game.pview||d.balls||[]);if(game.place&&!game.pview)bs=bs.filter(b=>b.i!==0).concat([{i:0,...game.place}]);return bs}
function playShots(list,done){
  game.anim=true;$("#pCtrl").style.visibility="hidden";$("#gamescr").classList.remove("myturn");
  const next=()=>{
    if(!game)return;const sh=list.shift();
    if(!sh){game.anim=false;done();return}
    const frames=[];P.simulate(sh.before,{x:sh.dx,y:sh.dy},sh.power,bs=>frames.push(bs));
    let k=0;const d=game.data;
    $("#gMsg").innerHTML=`${esc(seatName(d.seats[sh.seat]))} vurdu…`;
    const tick=()=>{if(!game)return;game.pview=frames[Math.min(k,frames.length-1)];drawPool();k+=3;
      if(k<frames.length+2)game.raf=requestAnimationFrame(tick);
      else{if(sh.foul)$("#gMsg").innerHTML=`Faul: ${esc(sh.reason)}`;setTimeout(next,list.length?450:150)}};
    game.pview=sh.before;drawPool();setTimeout(()=>{game.raf=requestAnimationFrame(tick)},250);
  };
  next();
}
function poolLayout(){
  const cv=$("#pc");if(!cv)return null;const box=cv.parentElement;const cw=box.clientWidth,ch=box.clientHeight;const dpr=Math.min(2,window.devicePixelRatio||1);
  if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){cv.width=Math.round(cw*dpr);cv.height=Math.round(ch*dpr);cv.style.width=cw+"px";cv.style.height=ch+"px";game.pstatic=null}
  const M=48,TW=P.W+2*M,TH=P.H+2*M,rot=ch>cw;
  const s=rot?Math.min(cw/TH,ch/TW):Math.min(cw/TW,ch/TH);
  const ox=rot?(cw-TH*s)/2+M*s:(cw-TW*s)/2+M*s,oy=rot?(ch-TW*s)/2+M*s:(ch-TH*s)/2+M*s;
  return{cv,dpr,s,ox,oy,rot,M,cw,ch,
    m:rot?[0,s*dpr,-s*dpr,0,(ox+P.H*s)*dpr,oy*dpr]:[s*dpr,0,0,s*dpr,ox*dpr,oy*dpr],
    toT:(sx,sy)=>rot?{x:(sy-oy)/s,y:P.H-(sx-ox)/s}:{x:(sx-ox)/s,y:(sy-oy)/s}};
}
// Masa (değişmeyen kısım) bir kez çizilip saklanır; her karede sadece toplar ve ıstaka çizilir
function poolStatic(L){
  const key=[L.cv.width,L.cv.height,mySkin("table"),mySkin("rack")].join();
  if(game.pstatic&&game.pstatic.key===key)return game.pstatic.cv;
  const cv=document.createElement("canvas");cv.width=L.cv.width;cv.height=L.cv.height;const c=cv.getContext("2d");c.setTransform(...L.m);
  const M=L.M,W=P.W,H=P.H;
  const felt=FELT_COL[mySkin("table")]||FELT_COL.yesil,rail=RAIL_COL[mySkin("rack")]||RAIL_COL.ceviz;
  // gölge
  c.save();c.shadowColor="rgba(0,0,0,.6)";c.shadowBlur=30;c.fillStyle=rail;roundRect(c,-M,-M,W+2*M,H+2*M,30);c.fill();c.restore();
  // ahşap kenar
  let g=c.createLinearGradient(0,-M,0,H+M);g.addColorStop(0,shade(rail,40));g.addColorStop(.08,rail);g.addColorStop(.5,shade(rail,-15));g.addColorStop(.92,rail);g.addColorStop(1,shade(rail,-45));
  c.fillStyle=g;roundRect(c,-M,-M,W+2*M,H+2*M,30);c.fill();
  c.strokeStyle="rgba(255,255,255,.18)";c.lineWidth=2;roundRect(c,-M+3,-M+3,W+2*M-6,H+2*M-6,27);c.stroke();
  // ahşap damarları
  c.save();roundRect(c,-M,-M,W+2*M,H+2*M,30);c.clip();c.globalAlpha=.08;c.strokeStyle="#000";c.lineWidth=1.2;
  for(let i=0;i<40;i++){const y=-M+((i*37)%(H+2*M));c.beginPath();c.moveTo(-M,y);c.bezierCurveTo(W*.3,y+8,W*.6,y-8,W+M,y+4);c.stroke()}c.restore();
  // çuha
  const fg=c.createRadialGradient(W/2,H/2,40,W/2,H/2,W*.62);fg.addColorStop(0,shade(felt,18));fg.addColorStop(1,shade(felt,-22));
  c.fillStyle=fg;c.fillRect(-14,-14,W+28,H+28);
  // çuha dokusu
  c.save();c.globalAlpha=.07;for(let i=0;i<2600;i++){c.fillStyle=i%2?"#fff":"#000";c.fillRect(((i*9301+49297)%233280)/233280*W,((i*4096+150889)%714025)/714025*H,1.2,1.2)}c.restore();
  // bantlar (lastik)
  const cush=shade(felt,-30);c.fillStyle=cush;
  const segs=[[0,-14,W/2,0,true],[W/2,-14,W,0,true],[0,H,W/2,H+14,false],[W/2,H,W,H+14,false]];
  for(const [x0,y0,x1,y1,top] of segs){const pad0=x0===0?36:26,pad1=x1===W?36:26;c.beginPath();
    if(top){c.moveTo(x0+pad0-12,y0);c.lineTo(x1-pad1+12,y0);c.lineTo(x1-pad1,y1);c.lineTo(x0+pad0,y1)}else{c.moveTo(x0+pad0,y0);c.lineTo(x1-pad1,y0);c.lineTo(x1-pad1+12,y1);c.lineTo(x0+pad0-12,y1)}c.closePath();c.fill()}
  for(const left of [true,false]){const x0=left?-14:W,x1=left?0:W+14;c.beginPath();
    if(left){c.moveTo(x0,24);c.lineTo(x1,36);c.lineTo(x1,H-36);c.lineTo(x0,H-24)}else{c.moveTo(x1,24);c.lineTo(x0,36);c.lineTo(x0,H-36);c.lineTo(x1,H-24)}c.closePath();c.fill()}
  c.strokeStyle="rgba(0,0,0,.35)";c.lineWidth=2;c.strokeRect(0,0,W,H);
  // elmaslar
  for(let k=1;k<8;k++){if(k===4)continue;for(const y of [-M/2-6,H+M/2+6])pearl(c,k*W/8,y)}
  for(let k=1;k<4;k++)for(const x of [-M/2-6,W+M/2+6])pearl(c,x,k*H/4);
  // cepler: pirinç halka + deri file
  for(const [x,y,r] of P.POCKETS){
    const br=c.createLinearGradient(x-r,y-r,x+r,y+r);br.addColorStop(0,"#f6e3a1");br.addColorStop(.45,"#b8892e");br.addColorStop(1,"#6e4e14");
    c.fillStyle=br;c.beginPath();c.arc(x,y,r*1.22,0,7);c.fill();
    c.fillStyle="#3b2414";c.beginPath();c.arc(x,y,r*1.05,0,7);c.fill();
    const hole=c.createRadialGradient(x-r*.25,y-r*.25,1,x,y,r*.95);hole.addColorStop(0,"#000");hole.addColorStop(.8,"#0c0c0c");hole.addColorStop(1,"#2a1a10");
    c.fillStyle=hole;c.beginPath();c.arc(x,y,r*.9,0,7);c.fill()}
  // tepe lambası ışığı
  const lamp=c.createRadialGradient(W/2,H/2,20,W/2,H/2,W*.55);lamp.addColorStop(0,"rgba(255,248,220,.16)");lamp.addColorStop(.6,"rgba(255,248,220,.04)");lamp.addColorStop(1,"rgba(0,0,0,.18)");
  c.fillStyle=lamp;c.fillRect(0,0,W,H);
  // kenar parlaklığı
  c.strokeStyle="rgba(255,255,255,.22)";c.lineWidth=1.5;roundRect(c,-M+8,-M+8,W+2*M-16,H+2*M-16,24);c.stroke();
  // başlangıç çizgisi ve noktalar
  c.strokeStyle="rgba(255,255,255,.14)";c.lineWidth=2;c.beginPath();c.moveTo(P.HEAD_X,0);c.lineTo(P.HEAD_X,H);c.stroke();
  c.fillStyle="rgba(255,255,255,.3)";[[250,H/2],[750,H/2]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,3,0,7);c.fill()});
  if(mySkin("table")==="vip_altin"){c.strokeStyle="#c9a43a";c.lineWidth=3;c.strokeRect(8,8,W-16,H-16)}
  game.pstatic={key,cv};return cv;
}
function roundRect(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function pearl(c,x,y){const g=c.createRadialGradient(x-1.5,y-1.5,.5,x,y,5);g.addColorStop(0,"#fff");g.addColorStop(1,"#cfc6b0");c.fillStyle=g;c.beginPath();c.ellipse(x,y,5,3.6,0,0,7);c.fill()}
function shade(hex,p){const n=parseInt(hex.slice(1),16);let r=n>>16,g=n>>8&255,b=n&255;const f=v=>Math.max(0,Math.min(255,Math.round(v+(p>0?(255-v):v)*p/100)));return"#"+[f(r),f(g),f(b)].map(v=>v.toString(16).padStart(2,"0")).join("")}
// Top resimleri bir kez çizilip saklanır
const ballSprites={};
function ballSprite(i,px){
  const k=i+"_"+px;if(ballSprites[k])return ballSprites[k];
  const cv=document.createElement("canvas");cv.width=cv.height=px;const c=cv.getContext("2d");const r=px/2;const col=BALL_COL[i>8?i-8:i];
  c.save();c.beginPath();c.arc(r,r,r-.5,0,7);c.clip();
  // canlı renk + hafif iç degrade
  const base=c.createRadialGradient(r*.7,r*.6,r*.1,r,r,r);base.addColorStop(0,i>8||i===0?"#ffffff":col);base.addColorStop(1,i>8||i===0?"#e9e4d6":col);
  c.fillStyle=base;c.fillRect(0,0,px,px);
  if(i>8){c.fillStyle=col;c.beginPath();c.ellipse(r,r,r*1.05,r*.58,0,0,7);c.fill()}
  if(i>0){c.fillStyle="#fffef8";c.beginPath();c.arc(r,r,r*.42,0,7);c.fill();c.fillStyle="#141414";c.font=`800 ${Math.round(r*(i>9?.5:.58))}px system-ui,Arial`;c.textAlign="center";c.textBaseline="middle";c.fillText(String(i),r,r+r*.04)}
  if(i===0){c.fillStyle="rgba(214,30,30,.7)";for(const [dx,dy] of [[0,0],[.55,.3],[-.5,-.35]]){c.beginPath();c.arc(r+dx*r,r+dy*r,r*.09,0,7);c.fill()}}
  c.restore();ballSprites[k]=cv;return cv;
}
// sabit ışık: gölge + parlama (top dönse de ışık yerinde kalır)
function ballShade(px){
  const k="sh_"+px;if(ballSprites[k])return ballSprites[k];
  const cv=document.createElement("canvas");cv.width=cv.height=px;const c=cv.getContext("2d");const r=px/2;
  c.beginPath();c.arc(r,r,r-.5,0,7);c.clip();
  const sh=c.createRadialGradient(r*.62,r*.55,r*.15,r,r,r*1.02);sh.addColorStop(0,"rgba(255,255,255,0)");sh.addColorStop(.62,"rgba(0,0,0,.08)");sh.addColorStop(.88,"rgba(0,0,0,.38)");sh.addColorStop(1,"rgba(0,0,0,.62)");c.fillStyle=sh;c.fillRect(0,0,px,px);
  const hl=c.createRadialGradient(r*.6,r*.52,0,r*.6,r*.52,r*.42);hl.addColorStop(0,"rgba(255,255,255,1)");hl.addColorStop(.25,"rgba(255,255,255,.55)");hl.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=hl;c.fillRect(0,0,px,px);
  const rim=c.createRadialGradient(r*1.35,r*1.4,0,r*1.35,r*1.4,r*.7);rim.addColorStop(0,"rgba(255,255,255,.28)");rim.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=rim;c.fillRect(0,0,px,px);
  ballSprites[k]=cv;return cv;
}
function drawPool(){
  if(!game||!game.data)return;const L=poolLayout();if(!L)return;const {cv}=L;const c=cv.getContext("2d");
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);c.drawImage(poolStatic(L),0,0);c.setTransform(...L.m);
  const d=game.data,bs=poolBalls(),my=mySeatIdx(d),R=P.R;
  const myTurn=d.status==="play"&&d.turn===my&&!game.anim&&!game.busy;
  // top gölgeleri
  c.fillStyle="rgba(0,0,0,.35)";for(const b of bs){c.beginPath();c.ellipse(b.x+3,b.y+4,R*1.02,R*.9,0,0,7);c.fill()}
  const cue=bs.find(b=>b.i===0);
  let ux=0,uy=0;
  if(myTurn&&cue&&game.aim){
    const dl=Math.hypot(game.aim.x,game.aim.y)||1;ux=game.aim.x/dl;uy=game.aim.y/dl;
    let tBest=Infinity,hit=null;
    for(const b of bs){if(b.i===0)continue;const fx=cue.x-b.x,fy=cue.y-b.y;const bq=fx*ux+fy*uy,cq=fx*fx+fy*fy-4*R*R;const disc=bq*bq-cq;if(disc<0)continue;const t=-bq-Math.sqrt(disc);if(t>0&&t<tBest){tBest=t;hit=b}}
    const tw=Math.min(ux>0?(P.W-R-cue.x)/ux:ux<0?(R-cue.x)/ux:Infinity,uy>0?(P.H-R-cue.y)/uy:uy<0?(R-cue.y)/uy:Infinity);
    const t=Math.min(tBest,tw),gx=cue.x+ux*t,gy=cue.y+uy*t;
    c.strokeStyle="rgba(255,255,255,.9)";c.lineWidth=2;c.setLineDash([]);c.beginPath();c.moveTo(cue.x+ux*R,cue.y+uy*R);c.lineTo(gx,gy);c.stroke();
    c.strokeStyle="rgba(255,255,255,.95)";c.lineWidth=2;c.beginPath();c.arc(gx,gy,R,0,7);c.stroke();
    if(hit&&tBest<=tw){
      const nx=hit.x-gx,ny=hit.y-gy,nl=Math.hypot(nx,ny)||1,ex=nx/nl,ey=ny/nl;
      const mine=d.groups?d.groups[my]:null,bad=mine&&P.typeOf(hit.i)!==mine&&!(hit.i===8&&!bs.some(b=>P.typeOf(b.i)===mine));
      c.strokeStyle=bad?"rgba(255,80,80,.95)":"rgba(255,235,120,.95)";c.lineWidth=3;c.beginPath();c.moveTo(hit.x,hit.y);c.lineTo(hit.x+ex*110,hit.y+ey*110);c.stroke();
      // beyaz topun sekme yönü
      const dot=ux*ex+uy*ey,tx=ux-ex*dot,ty=uy-ey*dot,tl=Math.hypot(tx,ty);
      if(tl>.05){c.strokeStyle="rgba(255,255,255,.5)";c.lineWidth=2;c.setLineDash([6,6]);c.beginPath();c.moveTo(gx,gy);c.lineTo(gx+tx/tl*60*tl,gy+ty/tl*60*tl);c.stroke();c.setLineDash([])}
      if(bad){c.strokeStyle="rgba(255,80,80,.95)";c.lineWidth=3;c.beginPath();c.moveTo(gx-6,gy-6);c.lineTo(gx+6,gy+6);c.moveTo(gx+6,gy-6);c.lineTo(gx-6,gy+6);c.stroke()}
    }
  }
  if(game.place&&!game.pview&&myTurn){c.strokeStyle="rgba(255,255,255,.7)";c.setLineDash([5,5]);c.lineWidth=2;c.beginPath();c.arc(game.place.x,game.place.y,R+8,0,7);c.stroke();c.setLineDash([]);
    c.fillStyle="rgba(255,255,255,.85)";c.font="bold 16px Arial";c.textAlign="center";c.save();c.translate(game.place.x,game.place.y-R-16);if(L.rot)c.rotate(-Math.PI/2);c.fillText("✋",0,0);c.restore()}
  // toplar
  const px=Math.max(8,Math.round(2*R*L.s*L.dpr));
  // toplar yuvarlanır: gidilen yola göre döner
  game.brot=game.brot||{};const shp=ballShade(px);
  for(const b of bs){const sp=ballSprite(b.i,px);const o=game.brot[b.i]||(game.brot[b.i]={x:b.x,y:b.y,a:0});const dl=Math.hypot(b.x-o.x,b.y-o.y);if(dl>0&&dl<200)o.a+=dl/R*(((b.x-o.x)+(b.y-o.y))>=0?1:-1);o.x=b.x;o.y=b.y;
    c.save();c.translate(b.x,b.y);c.save();c.rotate(o.a);c.drawImage(sp,-R,-R,2*R,2*R);c.restore();if(L.rot)c.rotate(-Math.PI/2);c.drawImage(shp,-R,-R,2*R,2*R);c.restore()}
  // ıstaka
  if(myTurn&&cue&&game.aim)drawCue(c,cue,ux,uy,game.pull||0);
}
function drawCue(c,cue,ux,uy,pull){
  const R=P.R,back=R+6+pull*90,len=560;
  const x0=cue.x-ux*back,y0=cue.y-uy*back,x1=cue.x-ux*(back+len),y1=cue.y-uy*(back+len);
  const nx=-uy,ny=ux;
  // gölge
  c.strokeStyle="rgba(0,0,0,.35)";c.lineWidth=9;c.lineCap="round";c.beginPath();c.moveTo(x0+6,y0+8);c.lineTo(x1+6,y1+8);c.stroke();
  const seg=(a,b,w0,w1,col)=>{const ax=cue.x-ux*(back+a),ay=cue.y-uy*(back+a),bx=cue.x-ux*(back+b),by=cue.y-uy*(back+b);
    const g=c.createLinearGradient(ax+nx*w1,ay+ny*w1,ax-nx*w1,ay-ny*w1);g.addColorStop(0,shade(col,-35));g.addColorStop(.35,shade(col,35));g.addColorStop(1,shade(col,-45));
    c.fillStyle=g;c.beginPath();c.moveTo(ax+nx*w0,ay+ny*w0);c.lineTo(bx+nx*w1,by+ny*w1);c.lineTo(bx-nx*w1,by-ny*w1);c.lineTo(ax-nx*w0,ay-ny*w0);c.closePath();c.fill()};
  seg(0,4,2.6,2.7,"#3a6fd8");      // uç (mavi tebeşir)
  seg(4,16,2.7,2.9,"#f2f2ee");     // fildişi halka
  seg(16,330,2.9,4.4,"#e3c48c");   // akçaağaç gövde
  seg(330,340,4.4,4.5,"#c0c0c0");  // metal ek yeri
  seg(340,470,4.5,5.6,"#2a1a12");  // abanoz
  seg(470,490,5.6,5.8,"#c9a43a");  // altın halka
  seg(490,len,5.8,6.2,"#1a1a1a");  // sap
}
function poolInput(){
  const cv=$("#pc");let drag=null,lastAng=null;
  const pt=e=>{const r=cv.getBoundingClientRect();const L=poolLayout();return L.toT(e.clientX-r.left,e.clientY-r.top)};
  const myTurn=()=>{const d=game&&game.data;return d&&d.status==="play"&&d.turn===mySeatIdx(d)&&!game.anim&&!game.busy};
  cv.addEventListener("pointerdown",e=>{if(!myTurn())return;const p=pt(e);e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(_){}
    if(game.place&&Math.hypot(p.x-game.place.x,p.y-game.place.y)<P.R*3.5){drag="cue";return}
    const c=curCue();if(!c)return;
    // beyaz topa yakınsa parmağı göster, uzaktaysa sürüklerken açıyı yavaşça döndür (ince ayar)
    drag="aim";lastAng=Math.atan2(p.y-c.y,p.x-c.x);if(Math.hypot(p.x-c.x,p.y-c.y)>P.R*4&&!game.aimTouched)aimAt(p);game.aimTouched=true});
  cv.addEventListener("pointermove",e=>{if(!drag||!myTurn())return;const p=pt(e);
    if(drag==="cue"){const d=game.data,others=d.balls.filter(b=>b.i!==0),k=d.ballInHand==="kitchen";
      const x=Math.max(P.R,Math.min(k?P.HEAD_X:P.W-P.R,p.x)),y=Math.max(P.R,Math.min(P.H-P.R,p.y));
      if(P.canPlace(others,x,y,k)){game.place={x,y};drawPool()}return}
    const c=curCue();if(!c)return;const ang=Math.atan2(p.y-c.y,p.x-c.x);
    let da=ang-lastAng;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;lastAng=ang;
    const dist=Math.hypot(p.x-c.x,p.y-c.y),k=dist<120?1:Math.max(.25,120/dist); // uzakta daha hassas
    const cur=Math.atan2(game.aim.y,game.aim.x)+da*k;game.aim={x:Math.cos(cur),y:Math.sin(cur)};drawPool()});
  const up=()=>{drag=null};cv.addEventListener("pointerup",up);cv.addEventListener("pointercancel",up);
  cv.addEventListener("dblclick",e=>{if(!myTurn())return;aimAt(pt(e))});
  function aimAt(p){const c=curCue();if(!c)return;const ax=p.x-c.x,ay=p.y-c.y;if(Math.hypot(ax,ay)<4)return;game.aim={x:ax,y:ay};drawPool()}
  // güç çubuğu: aşağı çek, bırak = vur
  const bar=$("#pPower");let pd=null;
  const setPull=(v)=>{game.pull=Math.max(0,Math.min(1,v));bar.style.setProperty("--p",game.pull);$("#pPowV").textContent=Math.round(game.pull*100)+"%";drawPool()};
  bar.addEventListener("pointerdown",e=>{if(!myTurn())return;e.preventDefault();try{bar.setPointerCapture(e.pointerId)}catch(_){}pd={y0:e.clientY,h:bar.getBoundingClientRect().height};setPull(0)});
  bar.addEventListener("pointermove",e=>{if(!pd)return;setPull((e.clientY-pd.y0)/(pd.h*.85))});
  const rel=e=>{if(!pd)return;pd=null;const p=game.pull||0;if(p<.04){setPull(0);return}shoot(Math.max(.05,p))};
  bar.addEventListener("pointerup",rel);bar.addEventListener("pointercancel",()=>{pd=null;setPull(0)});
}
async function shoot(power){
  if(!game||!game.data||!game.aim||game.anim||game.busy)return;
  // ıstaka ileri hareket animasyonu
  const p0=game.pull||power;const t0=performance.now();
  await new Promise(res=>{const step=now=>{const k=Math.min(1,(now-t0)/110);game.pull=p0*(1-k);drawPool();if(k<1)requestAnimationFrame(step);else res()};requestAnimationFrame(step)});
  sfx("ball");
  const body={action:"shoot",dx:game.aim.x,dy:game.aim.y,power};
  if(game.place){body.cx=game.place.x;body.cy=game.place.y}
  game.aim=null;game.pull=0;game.aimTouched=false;$("#pPower").style.setProperty("--p",0);
  await gameMove(body);
}
// ince nişan düğmeleri (basılı tutunca döner)
for(const [id,dir] of [["pRotL",-1],["pRotR",1]]){let t=null;const b=$("#"+id);
  const tick=()=>{if(!game||!game.aim)return;const a=Math.atan2(game.aim.y,game.aim.x)+dir*0.0035;game.aim={x:Math.cos(a),y:Math.sin(a)};drawPool()};
  b.addEventListener("pointerdown",e=>{e.preventDefault();tick();t=setInterval(tick,40)});["pointerup","pointerleave","pointercancel"].forEach(ev=>b.addEventListener(ev,()=>clearInterval(t)))}
window.addEventListener("resize",()=>{if(game&&game.data&&game.data.type==="pool"){game.pstatic=null;drawPool()}});

function sortRack(mode){
  if(!game||!game.data||!game.data.indicator)return;const ok=tOkey(game.data.indicator);
  const key=t=>tIsWild(t,ok)?[9,99]:tIsFake(t)?[ok.c,ok.n]:[tColor(t),tNum(t)];
  const tiles=[...game.hand];let groups=[];
  if(mode==="run"){
    // perler (aynı sayı farklı renk) ve seriler (aynı renk ardışık, okeyle boşluk doldurma, 12-13-1)
    const r=OK.arrange(tiles,{c:ok.c,n:ok.n});
    groups=[...r.groups];
    // kalanlar: renk ve sayıya göre sıralı, en sonda
    const rest=r.rest.sort((a,b)=>(key(a)[0]-key(b)[0])||(key(a)[1]-key(b)[1]));if(rest.length){rest.loose=true;groups.push(rest)}
  }else if(mode==="oldrun"){
    const by={};tiles.forEach(t=>{const [c]=key(t);(by[c]=by[c]||[]).push(t)});
    Object.keys(by).sort().forEach(c=>{const arr=by[c].sort((a,b)=>key(a)[1]-key(b)[1]);let g=[];
      arr.forEach(t=>{if(g.length&&key(t)[1]-key(g[g.length-1])[1]>1&&c!=="9"){groups.push(g);g=[]}g.push(t)});if(g.length)groups.push(g)});
    // tek kalan taşlar en sonda yan yana dursun
    const singles=groups.filter(g=>g.length<2).flat();groups=groups.filter(g=>g.length>=2);if(singles.length)groups.push(singles);
  }else{
    // aynı sayılar (farklı renk) ya da aynı taş çiftleri bir grup
    const k=t=>{const v=key(t);return v[0]*100+v[1]};const by={};tiles.forEach(t=>{(by[k(t)]=by[k(t)]||[]).push(t)});
    const pairs=Object.values(by).filter(g=>g.length>1),singles=Object.values(by).filter(g=>g.length===1).flat().sort((a,b)=>k(a)-k(b));
    groups=[...pairs];if(singles.length)groups.push(singles);
  }
  // grupları aralarında birer boşlukla iki kata yerleştir
  const slots=Array(SLOTS).fill(null);let pos=0;const half=SLOTS/2;
  for(const g of groups){if(pos<half&&pos+g.length>half&&!g.loose)pos=half;if(pos+g.length>SLOTS)pos=slots.indexOf(null);
    for(const t of g){while(pos<SLOTS&&slots[pos]!=null)pos++;if(pos>=SLOTS)break;slots[pos++]=t}pos++}
  for(const t of tiles)if(!slots.includes(t)){const i=slots.indexOf(null);if(i>=0)slots[i]=t}
  game.slots=slots;game.sel=null;game.newTiles=null;sfx("tile");renderGame();
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
  if(p==="granted"){setupPush(false);getDoc(doc(fs,"private",me,"data","push")).then(s=>{const x=s.exists()?s.data():{};
    openInfoModal("🔔 Bildirim ayarları",[["noDm","Birebir mesajlar"],["noGroup","Grup mesajları (senden bahsedilirse yine gelir)"],["noCall","Gelen aramalar"]].map(([k,l])=>`<label class="tgl"><span><b>${l}</b></span><input type="checkbox" data-np="${k}" ${x[k]?"":"checked"}></label>`).join("")+'<p class="isub">Belirli bir sohbeti sessize almak için sohbete uzun bas.</p>');
    $("#eBody").onchange=e=>{const k=e.target.dataset.np;if(k)setDoc(doc(fs,"private",me,"data","push"),{[k]:!e.target.checked},{merge:true}).catch(()=>toast("Kaydedilemedi"))}}).catch(()=>{});return}
  if(p==="denied"){openModal({title:"Bildirimler kapalı",text:"Bildirim izni daha önce reddedilmiş. Telefonda <b>Ayarlar → Uygulamalar → TR Mesaj → Bildirimler</b>'den açabilirsin. Bilgisayarda adres çubuğundaki kilit simgesinden izin verebilirsin.",input:false,cancel:false});return}
  setupPush(true).then(ok=>toast(ok?"Bildirimler açıldı 🔔":"Bildirim izni verilmedi")).catch(()=>toast("Bildirimler açılamadı"));
}
if("serviceWorker" in navigator)navigator.serviceWorker.addEventListener("message",e=>{if(e.data&&e.data.type==="open"){try{const c=new URL(e.data.url,location.origin).searchParams.get("c");if(c){deepLink=c;openPendingDeepLink()}const k=new URL(e.data.url,location.origin).searchParams.get("call");if(k&&callLog[k])onIncoming(k,callLog[k])}catch(_){}}});
let deepLink=null,pendingCallId=null,deepGame=null,deepJoin=null;
let deepAdd=null;try{const a=new URLSearchParams(location.search).get("add");if(a&&/^\d{6}$/.test(a))deepAdd=a}catch(e){}
try{const j=new URLSearchParams(location.search).get("j");if(j&&/^[A-Za-z0-9]{10,40}\.[A-Za-z0-9]{8,32}$/.test(j))deepJoin=j}catch(e){}
try{deepGame=new URLSearchParams(location.search).get("g");if(deepGame&&!/^[A-Za-z0-9]{10,40}$/.test(deepGame))deepGame=null}catch(e){}
try{pendingCallId=new URLSearchParams(location.search).get("call");deepLink=new URLSearchParams(location.search).get("c");if(deepLink||location.search)history.replaceState(null,"","/")}catch(e){}
let goParam=null,shareText=null;try{const q=new URLSearchParams(location.search);goParam=q.get("go");const st=[q.get("st"),q.get("sx"),q.get("su")].filter(Boolean).join(" ").trim();if(st)shareText=st.slice(0,2000)}catch(e){}
async function checkReturnGame(){try{const id=localStorage.getItem("tr-lastgame");if(!id||game)return;const s=await getDoc(doc(fs,"games",id));if(!s.exists())return;const d=s.data();
  if(d.status!=="play"||mySeatIdx(d)<0||Date.now()-(d.updatedAt||0)>15*60e3)return;const bar=$("#noticeBar");if(!bar)return;
  bar.className="noticebar show";bar.innerHTML=`<span>${gk(d.type)[0]} Yarım kalan ${gk(d.type)[1]} oyunun var</span><button id="nbBack">Masaya dön</button>`;$("#nbBack").onclick=()=>{bar.classList.remove("show");openGame(id)}}catch(e){}}
function openPendingDeepLink(){
  if(ready&&!window.__retChecked){window.__retChecked=1;setTimeout(checkReturnGame,1500)}
  if(ready&&goParam){const g=goParam;goParam=null;if(g==="okey"||g==="tavla"){const t=document.querySelector('[data-tab="games"]');t&&t.click();setTimeout(()=>openPublic(g),400)}else if(g==="add")askAdd()}
  if(ready&&shareText){const t=shareText;shareText=null;pickFriends("📤 Kime gönderelim?","Gönder",async sel=>{for(const to of sel.slice(0,20))await sendContent(to,{t:"text",text:t});toast("Gönderildi")},{extra:`<div class="pk" style="display:block;white-space:pre-wrap">${esc(t.slice(0,300))}</div>`})}
  if(deepGame&&ready){const g=deepGame;deepGame=null;openGame(g)}
  if(deepAdd&&ready){const a=deepAdd;deepAdd=null;if(a!==users[me]?.code)openModal({title:"Arkadaş ekle",text:`TR ID ${fmtCode(a)} kişisine arkadaşlık isteği gönderilsin mi?`,input:false,ok:"İstek gönder"},()=>addById(a))}
  if(deepJoin&&ready){const [gid,tok]=deepJoin.split(".");deepJoin=null;
    if(groups[gid]){openChat("g:"+gid)}
    else openModal({title:"Gruba katıl",text:"Davet bağlantısıyla bir gruba katılmak üzeresin. Katılınca grup üyeleri adını ve TR ID'ni görür.",input:false,ok:"Katıl"},async()=>{
      try{await updateDoc(doc(fs,"groups",gid),{members:arrayUnion(me),jt:tok});toast("Gruba katıldın 🎉");setTimeout(()=>openChat("g:"+gid),1200)}catch(e){toast("Bağlantı geçersiz ya da grup dolu")}})}
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
