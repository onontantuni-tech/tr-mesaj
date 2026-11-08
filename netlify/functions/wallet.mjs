// Cüzdan: bakiye, seviye, desenler. Hoş geldin hediyesi ilk girişte bir kez verilir.
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";
import { FieldValue } from "firebase-admin/firestore";
import { migrateFriends, areFriends } from "../lib/friends.mjs";
import { hasBad } from "../lib/filter.mjs";
import * as K from "../lib/kelime.mjs";
import * as QZ from "../lib/quiz.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  let b;
  try { b = await req.json(); } catch { b = {}; }
  const { db } = admin();
  const act = String(b?.action || "me");
  const ref = db.doc(`wallets/${uid}`);
  let migrate = false;
  let giftOk = false, rateOk = false, evMul = 1, evName = "";
  if (act === "daily") {
    // Mevsimlik etkinlik (bayram, yılbaşı…): yöneticinin açtığı çarpan günlük hediyeye uygulanır
    try { const c = await db.doc("config/app").get(); const ev = c.exists ? c.data().event : null; if (ev && ev.until > Date.now()) { evMul = Math.max(1, Math.min(3, Number(ev.mul) || 1)); evName = String(ev.name || "").slice(0, 40); } } catch {}
  }
  if (act === "rate") {
    const gid = String(b?.gid || ""), to = String(b?.to || "");
    if (/^[A-Za-z0-9]{10,40}$/.test(gid)) {
      const gs = await db.doc(`games/${gid}`).get();
      const seated = gs.exists ? (gs.data().seats || []).filter((x) => x && !x.bot).map((x) => x.uid) : [];
      rateOk = seated.includes(uid) && seated.includes(to) && to !== uid;
    }
  }
  if (act === "gift") {
    const to = String(b?.to || "");
    giftOk = /^[A-Za-z0-9]{10,40}$/.test(to) && (await areFriends(db, uid, to));
  }
  if (act === "me") {
    try {
      const w0 = await ref.get();
      if (!w0.exists || !w0.data().fm) { await migrateFriends(db, uid); migrate = true; }
    } catch {}
  }

  // Jeton hareketlerim (son 60)
  if (act === "ledger") {
    const q = await db.collection("ledger").where("uid", "==", uid).limit(300).get();
    const rows = q.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 60).map((r) => ({ at: r.at, delta: r.delta, reason: r.reason, after: r.after }));
    return json(200, { rows });
  }
  // Davet eden kişinin TR ID'si (sadece yeni hesaplar, bir kez)
  let inviter = null;
  if (act === "ref") {
    const code = String(b.code || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) return json(400, { error: "code" });
    const cs = await db.doc(`codes/${code}`).get();
    if (!cs.exists) return json(404, { error: "notfound" });
    inviter = cs.data().uid;
    if (inviter === uid) return json(400, { error: "self" });
  }

  try {
    const res = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let w = s.exists ? s.data() : null;
      // davet ödülü: davet edilen ilk oyununu bitirdiyse davet edene ver (okumalar yazmalardan önce)
      let invRef = null, invW = null;
      if (w && w.refBy && !w.refPaid && (w.games || 0) >= 1) {
        invRef = db.doc(`wallets/${w.refBy}`);
        const is = await tx.get(invRef);
        invW = is.exists ? is.data() : null;
      }
      let welcomed = false, back = 0;
      if (w && act === "me") {
        // "Seni özledik": 7 günden uzun aradan sonra ilk girişte bir kez hediye
        const away = Date.now() - (w.lastMe || Date.now());
        if (away > 7 * 86400000) { back = E.COMEBACK; E.credit(tx, db, uid, w, back, "Seni özledik hediyesi"); }
        w.lastMe = Date.now();
      }
      if (!w) {
        w = E.newWallet();
        tx.set(db.collection("ledger").doc(), { uid, delta: E.WELCOME_BONUS, reason: "Hoş geldin hediyesi", by: "system", at: Date.now(), after: w.balance });
        welcomed = true;
      }

      if (invRef) {
        w.refPaid = true;
        if (invW) {
          E.credit(tx, db, w.refBy, invW, E.REFERRAL_BONUS, "Arkadaşını çağır hediyesi");
          invW.refCount = (invW.refCount || 0) + 1;
          const { month } = E.trDate();
          invW.refMonth = invW.refMonthKey === month ? (invW.refMonth || 0) + 1 : 1;
          invW.refMonthKey = month;
          tx.set(db.doc(`lb_ref/${month}/u/${w.refBy}`), { n: FieldValue.increment(1) }, { merge: true });
          tx.set(invRef, invW);
        }
      }

      if (act === "ref") {
        if (w.refBy) return { status: 409, body: { error: "set" } };
        if (s.exists && Date.now() - (w.createdAt || 0) > 7 * 86400000) return { status: 409, body: { error: "old" } };
        if ((w.games || 0) > 0) return { status: 409, body: { error: "old" } };
        w.refBy = inviter;
        w.refPaid = false;
        // davet eden ile davet edilen arkadaş olur
        const a = uid < inviter ? uid : inviter, z = uid < inviter ? inviter : uid;
        tx.set(db.doc(`friends/${a}_${z}`), { members: [a, z], from: inviter, to: uid, status: "accepted", at: Date.now() });
      }

      // Saatlik sandık: 4 saatte bir (VIP iki kat)
      let gift = null, club = null, vipCoins = 0;
      if (act === "chest") {
        const wait = E.CHEST.every - (Date.now() - (w.chestAt || 0));
        if (wait > 0) return { status: 409, body: { error: "wait", wait, wallet: view(w) } };
        const amount = E.CHEST.amount * (E.isVip(w) ? 2 : 1);
        E.credit(tx, db, uid, w, amount, "Saatlik sandık");
        w.chestAt = Date.now();
        gift = { amount };
      }
      // Jetonu biten oyuncuya günde bir destek
      if (act === "rescue") {
        const today = E.trDate().day;
        if ((w.balance || 0) >= E.RESCUE.below || w.rescueDay === today) return { status: 409, body: { error: "no", wallet: view(w) } };
        E.credit(tx, db, uid, w, E.RESCUE.amount, "Jeton desteği");
        w.rescueDay = today;
        gift = { amount: E.RESCUE.amount };
      }
      // Günlük çark: sonuç sunucuda belirlenir
      // Akşam turnuvasına katıl
      if (act === "tjoin") {
        const d = E.trDate();
        if (w.tourDay === d.day) return { status: 409, body: { error: "joined", wallet: view(w) } };
        if (d.hour >= E.TOUR.joinUntil) return { status: 409, body: { error: "closed", wallet: view(w) } };
        if (!w.adult) return { status: 403, body: { error: "age" } };
        if ((w.balance || 0) < E.TOUR.fee) return { status: 402, body: { error: "balance", wallet: view(w) } };
        E.credit(tx, db, uid, w, -E.TOUR.fee, `Akşam turnuvası katılımı (${d.day})`);
        w.tourDay = d.day;
        tx.set(db.doc(`tour/${d.day}/p/${uid}`), { points: 0, wins: 0, games: 0, at: Date.now() }, { merge: true });
        tx.set(db.doc(`tour/${d.day}`), { n: FieldValue.increment(1) }, { merge: true });
      }
      if (act === "spin") {
        const today = E.trDate().day;
        if (w.spinDay === today) return { status: 409, body: { error: "spun", wallet: view(w) } };
        const tot = E.WHEEL.reduce((a, x) => a + x.w, 0);
        let r = Math.random() * tot, idx = 0;
        for (; idx < E.WHEEL.length - 1; idx++) { r -= E.WHEEL[idx].w; if (r < 0) break; }
        E.credit(tx, db, uid, w, E.WHEEL[idx].amount, "Günlük çark");
        w.spinDay = today;
        gift = { amount: E.WHEEL[idx].amount, idx };
      }
      // Günlük görev ödülü
      if (act === "task") {
        const t = E.todayTasks(w), task = E.tasksFor(t).find((x) => x.id === b.id);
        if (!task) return { status: 400, body: { error: "task" } };
        if (!task.need(t) || (t.claimed || []).includes(task.id)) return { status: 409, body: { error: "no", wallet: view(w) } };
        E.credit(tx, db, uid, w, task.prize, `Görev: ${task.text}`);
        t.claimed = [...(t.claimed || []), task.id];
        w.td = t;
        gift = { amount: task.prize };
      }

      // Günlük giriş hediyesi
      let daily = null;
      if (act === "daily") {
        const today = E.trDate().day, yesterday = E.trDate(Date.now() - 86400000).day;
        if (w.lastDaily === today) return { status: 409, body: { error: "claimed", wallet: view(w) } };
        const streak = w.lastDaily === yesterday ? ((w.streak || 0) % 30) + 1 : 1;
        const amount = Math.round(E.LOGIN_CALENDAR[streak - 1] * evMul);
        E.credit(tx, db, uid, w, amount, `Günlük giriş hediyesi (${streak}. gün)${evMul > 1 ? ` · ${evName} x${evMul}` : ""}`);
        w.streak = streak;
        w.lastDaily = today;
        daily = { day: streak, amount, vip: 0 };
        if (streak === 30) {
          w.vipUntil = Math.max(Date.now(), w.vipUntil || 0) + E.LOGIN_VIP_DAYS * 86400000;
          tx.set(db.doc(`badges/${uid}`), { vipUntil: w.vipUntil }, { merge: true });
          daily.vip = E.LOGIN_VIP_DAYS;
        }
      }

      // 18 yaş beyanı: doğum yılı. Jetonlu masalar ve satın almalar sadece 18 yaş üstüne açık.
      if (act === "age") {
        const y = Math.floor(Number(b.birthYear));
        const now = new Date(Date.now() + 3 * 3600e3).getUTCFullYear();
        if (!(y >= 1900 && y <= now)) return { status: 400, body: { error: "year" } };
        if (w.birthYear) return { status: 409, body: { error: "set" } };
        w.birthYear = y;
        w.adult = now - y > 18 || (now - y === 18 && !!b.hadBirthday);
      }

      // Kulüp kur / katıl / ayrıl
      if (act === "clubCreate") {
        if (w.club) return { status: 409, body: { error: "inclub" } };
        const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 24);
        const icon = E.CLUB.icons.includes(b.icon) ? b.icon : E.CLUB.icons[0];
        if (name.length < 3 || hasBad(name)) return { status: 400, body: { error: "name" } };
        if ((w.balance || 0) < E.CLUB.price) return { status: 402, body: { error: "balance", wallet: view(w) } };
        let code = "";
        for (let i = 0; i < 6; i++) code += "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)];
        const cref = db.doc(`clubs/${code}`);
        if ((await tx.get(cref)).exists) return { status: 409, body: { error: "retry" } };
        E.credit(tx, db, uid, w, -E.CLUB.price, `Kulüp kuruldu: ${name}`);
        tx.set(cref, { name, icon, owner: uid, members: [uid], at: Date.now() });
        w.club = code;
        club = { code };
      }
      if (act === "clubJoin") {
        if (w.club) return { status: 409, body: { error: "inclub" } };
        const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const cref = db.doc(`clubs/${code}`);
        const cs = code.length === 6 ? await tx.get(cref) : null;
        if (!cs || !cs.exists) return { status: 404, body: { error: "notfound" } };
        const c = cs.data();
        if ((c.members || []).length >= E.CLUB.max) return { status: 409, body: { error: "full" } };
        tx.update(cref, { members: [...new Set([...(c.members || []), uid])] });
        w.club = code;
        club = { code };
      }
      if (act === "clubLeave") {
        if (!w.club) return { status: 200, body: { wallet: view(w) } };
        const cref = db.doc(`clubs/${w.club}`);
        const cs = await tx.get(cref);
        if (cs.exists) {
          const c = cs.data();
          const members = (c.members || []).filter((x) => x !== uid);
          if (!members.length) tx.delete(cref);
          else tx.update(cref, { members, owner: c.owner === uid ? members[0] : c.owner });
        }
        w.club = null;
      }
      // Oyun sonrası rakibi değerlendirme (👍/👎): oyun başına rakip başına bir kez
      if (act === "rate") {
        const gid = String(b.gid || ""), to = String(b.to || ""), v = b.v === 1 ? 1 : b.v === -1 ? -1 : 0;
        if (!/^[A-Za-z0-9]{10,40}$/.test(gid) || !/^[A-Za-z0-9]{10,40}$/.test(to) || to === uid || !v) return { status: 400, body: { error: "rate" } };
        if (!rateOk) return { status: 403, body: { error: "seat" } };
        const key = gid + "_" + to;
        if ((w.rated || []).includes(key)) return { status: 409, body: { error: "done" } };
        w.rated = [...(w.rated || []).slice(-199), key];
        tx.set(db.doc(`ratings/${to}`), { [v > 0 ? "up" : "down"]: FieldValue.increment(1) }, { merge: true });
        gift = { rated: v };
      }
      // Kelimece: günlük kelime tahmini (cevap sunucuda)
      if (act === "kelime") {
        const day = E.trDate().day, idx = K.dayIdx(day);
        const st = w.kel2 && w.kel2.day === day ? w.kel2 : { day, q: idx.map(() => ({ g: [], s: [], ok: false })) };
        if (b.guess !== undefined) {
          const qi = Math.floor(Number(b.q));
          const it = st.q[qi];
          if (!it) return { status: 400, body: { error: "q" } };
          const ans = K.norm(K.PUZ[idx[qi]][1]);
          const g = K.norm(String(b.guess || ""));
          if (!K.LETTERS.test(g) || [...g].length !== [...ans].length) return { status: 400, body: { error: "len", len: [...ans].length } };
          if (it.ok || it.g.length >= K.TRIES) return { status: 409, body: { error: "done" } };
          it.g = [...it.g, g]; it.s = [...it.s, K.score(g, ans).join("")];
          if (g === ans) { it.ok = true; E.credit(tx, db, uid, w, K.PRIZE, "Kelimece ödülü"); gift = { amount: K.PRIZE }; }
          w.kel2 = st;
        }
        tx.set(ref, w);
        const out = st.q.map((it, i) => { const ans = K.norm(K.PUZ[idx[i]][1]); const over = it.ok || it.g.length >= K.TRIES;
          return { clue: K.PUZ[idx[i]][0], len: [...ans].length, g: it.g, s: it.s, ok: it.ok, ans: over ? ans : null, first: ans[0] }; });
        return { status: 200, body: { kel: out, tries: K.TRIES, prize: K.PRIZE, gift, wallet: view(w) } };
      }
      // Günün bilgi yarışması: sorular istemciye cevapsız gider, cevaplar burada kontrol edilir
      if (act === "quiz") {
        const day = E.trDate().day, idx = QZ.dayQs(day);
        const done = w.qz && w.qz.day === day ? w.qz : null;
        if (Array.isArray(b.answers) && !done) {
          const ans = idx.map((_, i) => Number(b.answers[i]));
          const right = idx.map((q, i) => (QZ.Q[q][2] === ans[i] ? 1 : 0));
          const n = right.reduce((a, x) => a + x, 0);
          w.qz = { day, ans, right, n };
          if (n) { E.credit(tx, db, uid, w, n * QZ.PRIZE, `Bilgi yarışması (${n}/${idx.length})`); gift = { amount: n * QZ.PRIZE }; }
        }
        tx.set(ref, w);
        const r = w.qz && w.qz.day === day ? w.qz : null;
        return { status: 200, body: { qs: idx.map((q) => ({ q: QZ.Q[q][0], o: QZ.Q[q][1] })), result: r ? { ans: r.ans, right: r.right, n: r.n, correct: idx.map((q) => QZ.Q[q][2]) } : null, prize: QZ.PRIZE, gift, wallet: view(w) } };
      }
      // Hediye kodu kullan
      if (act === "redeem") {
        const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
        if (code.length < 5) return { status: 400, body: { error: "code" } };
        if ((w.codes || []).includes(code)) return { status: 409, body: { error: "used" } };
        const cref = db.doc(`giftcodes/${code}`); const cs = await tx.get(cref);
        if (!cs.exists) return { status: 404, body: { error: "notfound" } };
        const c = cs.data();
        if ((c.used || 0) >= (c.uses || 1)) return { status: 410, body: { error: "spent" } };
        tx.update(cref, { used: (c.used || 0) + 1 });
        w.codes = [...(w.codes || []), code].slice(-100);
        E.credit(tx, db, uid, w, c.amount, `Hediye kodu: ${code}`);
        gift = { amount: c.amount };
      }
      // Şehir (şehir sıralaması için)
      if (act === "city") {
        const city = E.CITIES.includes(b.city) ? b.city : null;
        if (!city) return { status: 400, body: { error: "city" } };
        w.city = city;
      }
      // Harcama iadesi (dünkü harcamaya göre)
      if (act === "cashback") {
        const v = E.spendView(w);
        if (v.claimed) return { status: 409, body: { error: "claimed", wallet: view(w) } };
        if (!v.amount) return { status: 409, body: { error: "none", wallet: view(w) } };
        E.credit(tx, db, uid, w, v.amount, `Harcama iadesi (%${Math.round(v.rate * 100)})`);
        w.cbDay = E.trDate().day;
        gift = { amount: v.amount };
      }
      // Sanal hediye (çay, gül, taç…): jetonla alınır, arkadaşın profiline eklenir. Jeton transferi değildir.
      if (act === "gift") {
        const it = E.GIFTS.find((x) => x.id === b.id);
        const to = String(b.to || "");
        if (!it || !/^[A-Za-z0-9]{10,40}$/.test(to) || to === uid) return { status: 400, body: { error: "gift" } };
        if (!giftOk) return { status: 403, body: { error: "friend" } };
        if ((w.balance || 0) < it.price) return { status: 402, body: { error: "balance", wallet: view(w) } };
        E.credit(tx, db, uid, w, -it.price, `Hediye: ${it.name}`);
        tx.set(db.doc(`badges/${to}`), { gifts: { [it.id]: FieldValue.increment(1) } }, { merge: true });
        w.giftsSent = (w.giftsSent || 0) + 1;
        E.checkAch(tx, db, uid, w);
        gift = { id: it.id };
      }
      if (act === "buyVip") {
        // Gerçek para ödemesi Play Store faturalandırması bağlanınca açılacak
        return { status: 402, body: { error: "billing" } };
      }

      if (act === "views") {
        const vip = E.isVip(w);
        return { status: 200, body: { vip, ...(await profileViews(db, uid, vip)) } };
      }

      if (act === "buySkin" || act === "equip") {
        const kind = b.kind === "rack" ? "rack" : b.kind === "tile" ? "tile" : "table";
        const item = E.SKINS[kind].find((x) => x.id === b.id);
        if (!item) return { status: 400, body: { error: "item" } };
        if (item.vip) {
          if (!E.isVip(w)) return { status: 403, body: { error: "vip" } };
          w.skin = { ...(w.skin || {}), [kind]: item.id };
          tx.set(ref, w);
          return { status: 200, body: { wallet: view(w), welcomed } };
        }
        w.owned = w.owned || { table: ["yesil"], rack: ["ceviz"] };
        w.owned[kind] = w.owned[kind] || [];
        if (item.price === 0 && !w.owned[kind].includes(item.id)) w.owned[kind].push(item.id);
        if (act === "buySkin" && !w.owned[kind].includes(item.id)) {
          if ((w.balance || 0) < item.price) return { status: 402, body: { error: "balance" } };
          E.credit(tx, db, uid, w, -item.price, `Desen: ${item.name}`);
          w.owned[kind].push(item.id);
        }
        if (!w.owned[kind].includes(item.id)) return { status: 403, body: { error: "notowned" } };
        w.skin = { ...(w.skin || {}), [kind]: item.id };
      }

      if (migrate) w.fm = 1;
      if (!w.createdAt) w.createdAt = Date.now();
      // VIP bittiyse VIP desenlerinden standart desene dön
      if (!E.isVip(w) && w.skin) {
        for (const k of ["table", "rack"]) {
          const it = E.SKINS[k].find((x) => x.id === w.skin[k]);
          if (it && it.vip) w.skin[k] = k === "table" ? "yesil" : "ceviz";
        }
      }
      if (act === "me") { E.checkAch(tx, db, uid, w); vipCoins = E.vipDrip(tx, db, uid, w, E.trDate().day); }
      tx.set(ref, w);
      return { status: 200, body: { wallet: view(w), welcomed, daily, gift, club, back, vipCoins } };
    });
    return json(res.status, res.body);
  } catch (e) {
    return json(500, { error: "server", detail: String((e && e.message) || e).slice(0, 200) });
  }
};

// Profilimi kimler gördü: VIP ise liste, değilse sadece sayı
async function profileViews(db, uid, vip) {
  const since = Date.now() - 30 * 86400000;
  const q = await db.collection(`profile_views/${uid}/v`).get();
  const rows = q.docs.map((d) => ({ uid: d.id, at: d.data().at || 0 })).filter((r) => r.at > since && r.uid !== uid).sort((a, b) => b.at - a.at);
  return vip ? { count: rows.length, list: rows.slice(0, 100) } : { count: rows.length };
}

function view(w) {
  const lv = E.levelFromXp(w.xp || 0);
  return {
    balance: w.balance || 0, xp: w.xp || 0, level: lv.level, levelCur: lv.cur, levelNext: lv.next,
    wins: w.wins || 0, games: w.games || 0, owned: w.owned, skin: w.skin, vipUntil: w.vipUntil || 0, adult: !!w.adult, ageSet: !!w.birthYear,
    streak: w.streak || 0, lastDaily: w.lastDaily || "", today: E.trDate().day, yesterday: E.trDate(Date.now() - 86400000).day,
    chestAt: w.chestAt || 0, chestEvery: E.CHEST.every, rescueDay: w.rescueDay || "", spinDay: w.spinDay || "", winStreak: w.winStreak || 0,
    tasks: (() => { const t = E.todayTasks(w); return E.tasksFor(t).map((x) => ({ id: x.id, text: x.text, prize: x.prize, prog: x.goal(t), done: x.need(t), claimed: (t.claimed || []).includes(x.id) })); })(),
    league: Math.max(0, Math.min(E.LEAGUES.length - 1, w.leagueWeek === E.weekId() ? (w.leagueTier ?? w.league ?? 0) : (w.league || 0))), week: E.weekId(), lastLeague: w.lastLeague || null,
    ach: w.ach || [], achStats: { wins: w.wins || 0, games: w.games || 0, maxStreak: w.maxStreak || 0, tw: w.tw || {}, marsN: w.marsN || 0, giftsSent: w.giftsSent || 0 },
    club: w.club || null, city: w.city || "", vipLeft: w.vipLeft || 0, cb: E.spendView(w),
    tourDay: w.tourDay || "", hour: E.trDate().hour, lastTour: w.lastTour || null,
    refBy: !!w.refBy, refCount: w.refCount || 0, canRef: !w.refBy && !(w.games > 0) && Date.now() - (w.createdAt || 0) < 7 * 86400000,
    catalog: { wheel: E.WHEEL.map((x) => x.amount), chest: E.CHEST, rescue: E.RESCUE, login: E.LOGIN_CALENDAR, loginVip: E.LOGIN_VIP_DAYS, refBonus: E.REFERRAL_BONUS, vip: E.VIP, skins: E.SKINS, packages: E.PACKAGES, tiers: E.TIERS, rake: E.RAKE, daily: E.DAILY_PRIZES, monthly: E.MONTHLY_PRIZES, leagues: E.LEAGUES, leagueMove: E.LEAGUE_MOVE, tour: E.TOUR, club: E.CLUB, cities: E.CITIES, titles: E.TITLES.map(({ id, name, icon }) => ({ id, name, icon })), refPrizes: E.REF_PRIZES, cashback: E.CASHBACK, gifts: E.GIFTS, ach: E.ACH.map(({ id, icon, name, desc, prize }) => ({ id, icon, name, desc, prize })) },
  };
}

export const config = { path: "/api/wallet" };
