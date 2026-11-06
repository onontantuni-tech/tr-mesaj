// Yönetim paneli: kullanıcıyı TR ID ile bul, bakiyesini gör, jeton yükle/düş.
// Yöneticiler TR ID ile tanımlanır (ADMIN_CODES ortam değişkeni, varsayılan 794985).
// TR ID → uid eşlemesi "codes" koleksiyonundan gelir; bu belgeler sadece bir kez oluşturulabilir, sonradan değiştirilemez.
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";

const ADMIN_CODES = (process.env.ADMIN_CODES || "794985").split(",").map((x) => x.trim()).filter(Boolean);

async function isAdmin(db, uid) {
  const snaps = await Promise.all(ADMIN_CODES.map((c) => db.doc(`codes/${c}`).get()));
  return snaps.some((s) => s.exists && s.data().uid === uid);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  const { db } = admin();
  if (!(await isAdmin(db, uid))) return json(403, { error: "admin" });
  let b;
  try { b = await req.json(); } catch { b = {}; }
  const act = String(b?.action || "check");
  if (act === "check") {
    const h = await db.doc("house/stats").get();
    return json(200, { admin: true, house: h.exists ? h.data() : { net: 0, rake: 0, botWin: 0, botStake: 0, hands: 0 } });
  }

  const code = String(b.code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return json(400, { error: "code" });
  const cs = await db.doc(`codes/${code}`).get();
  if (!cs.exists) return json(404, { error: "notfound" });
  const target = cs.data().uid;

  if (act === "lookup") {
    const [u, w, led] = await Promise.all([
      db.doc(`users/${target}`).get(),
      db.doc(`wallets/${target}`).get(),
      db.collection("ledger").where("uid", "==", target).limit(200).get(),
    ]);
    const wl = w.exists ? w.data() : null;
    const lv = E.levelFromXp(wl?.xp || 0);
    const history = led.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 30);
    return json(200, {
      user: { code, name: u.exists ? u.data().nick || "" : "", joined: u.exists ? u.data().joined || 0 : 0 },
      wallet: wl ? { balance: wl.balance || 0, level: lv.level, xp: wl.xp || 0, wins: wl.wins || 0, games: wl.games || 0 } : null,
      history,
    });
  }

  if (act === "adjust") {
    const amount = Math.trunc(Number(b.amount));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000) return json(400, { error: "amount" });
    const reason = String(b.reason || (amount > 0 ? "Yönetici yüklemesi" : "Yönetici düşümü")).slice(0, 80);
    const balance = await db.runTransaction(async (tx) => {
      const ref = db.doc(`wallets/${target}`);
      const s = await tx.get(ref);
      const w = s.exists ? s.data() : E.newWallet();
      if (!s.exists) tx.set(db.collection("ledger").doc(), { uid: target, delta: E.WELCOME_BONUS, reason: "Hoş geldin hediyesi", by: "system", at: Date.now(), after: w.balance });
      E.credit(tx, db, target, w, amount, reason, uid);
      tx.set(ref, w);
      return w.balance;
    });
    return json(200, { ok: true, balance });
  }

  return json(400, { error: "action" });
};

export const config = { path: "/api/admin" };
