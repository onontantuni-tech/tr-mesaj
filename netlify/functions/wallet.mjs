// Cüzdan: bakiye, seviye, desenler. Hoş geldin hediyesi ilk girişte bir kez verilir.
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";
import { migrateFriends } from "../lib/friends.mjs";

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
      let welcomed = false;
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

      // Günlük giriş hediyesi
      let daily = null;
      if (act === "daily") {
        const today = E.trDate().day, yesterday = E.trDate(Date.now() - 86400000).day;
        if (w.lastDaily === today) return { status: 409, body: { error: "claimed", wallet: view(w) } };
        const streak = w.lastDaily === yesterday ? ((w.streak || 0) % 30) + 1 : 1;
        const amount = E.LOGIN_CALENDAR[streak - 1];
        E.credit(tx, db, uid, w, amount, `Günlük giriş hediyesi (${streak}. gün)`);
        w.streak = streak;
        w.lastDaily = today;
        daily = { day: streak, amount, vip: 0 };
        if (streak === 30) {
          w.vipUntil = Math.max(Date.now(), w.vipUntil || 0) + E.LOGIN_VIP_DAYS * 86400000;
          tx.set(db.doc(`badges/${uid}`), { vipUntil: w.vipUntil });
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

      if (act === "buyVip") {
        if (!w.adult) return { status: 403, body: { error: "age" } };
        if ((w.balance || 0) < E.VIP.price) return { status: 402, body: { error: "balance" } };
        E.credit(tx, db, uid, w, -E.VIP.price, `VIP üyelik (${E.VIP.days} gün)`);
        const now = Date.now();
        w.vipUntil = Math.max(now, w.vipUntil || 0) + E.VIP.days * 86400000;
        tx.set(db.doc(`badges/${uid}`), { vipUntil: w.vipUntil });
      }

      if (act === "views") {
        const vip = E.isVip(w);
        return { status: 200, body: { vip, ...(await profileViews(db, uid, vip)) } };
      }

      if (act === "buySkin" || act === "equip") {
        const kind = b.kind === "rack" ? "rack" : "table";
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
      tx.set(ref, w);
      return { status: 200, body: { wallet: view(w), welcomed, daily } };
    });
    return json(res.status, res.body);
  } catch (e) {
    return json(500, { error: "server" });
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
    refBy: !!w.refBy, refCount: w.refCount || 0, canRef: !w.refBy && !(w.games > 0) && Date.now() - (w.createdAt || 0) < 7 * 86400000,
    catalog: { login: E.LOGIN_CALENDAR, loginVip: E.LOGIN_VIP_DAYS, refBonus: E.REFERRAL_BONUS, vip: E.VIP, skins: E.SKINS, packages: E.PACKAGES, tiers: E.TIERS, rake: E.RAKE, daily: E.DAILY_PRIZES, monthly: E.MONTHLY_PRIZES },
  };
}

export const config = { path: "/api/wallet" };
