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

  try {
    const res = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let w = s.exists ? s.data() : null;
      let welcomed = false;
      if (!w) {
        w = E.newWallet();
        tx.set(db.collection("ledger").doc(), { uid, delta: E.WELCOME_BONUS, reason: "Hoş geldin hediyesi", by: "system", at: Date.now(), after: w.balance });
        welcomed = true;
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
      // VIP bittiyse VIP desenlerinden standart desene dön
      if (!E.isVip(w) && w.skin) {
        for (const k of ["table", "rack"]) {
          const it = E.SKINS[k].find((x) => x.id === w.skin[k]);
          if (it && it.vip) w.skin[k] = k === "table" ? "yesil" : "ceviz";
        }
      }
      tx.set(ref, w);
      return { status: 200, body: { wallet: view(w), welcomed } };
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
    catalog: { vip: E.VIP, skins: E.SKINS, packages: E.PACKAGES, tiers: E.TIERS, rake: E.RAKE, daily: E.DAILY_PRIZES, monthly: E.MONTHLY_PRIZES },
  };
}

export const config = { path: "/api/wallet" };
