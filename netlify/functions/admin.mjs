// Yönetim paneli: kullanıcıyı TR ID ile bul, bakiyesini gör, jeton yükle/düş.
// Yöneticiler TR ID ile tanımlanır (ADMIN_CODES ortam değişkeni, varsayılan 794985).
// TR ID → uid eşlemesi "codes" koleksiyonundan gelir; bu belgeler sadece bir kez oluşturulabilir, sonradan değiştirilemez.
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";
import { FOREVER, REPORT_REASONS } from "../lib/moderation.mjs";

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

  // Şikâyetler
  if (act === "reports") {
    const q = await db.collection("reports").where("status", "==", "open").limit(100).get();
    const rows = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at);
    const uids = [...new Set(rows.flatMap((r) => [r.by, r.target]))];
    const us = await Promise.all(uids.map((u) => db.doc(`users/${u}`).get()));
    const bans = await Promise.all(uids.map((u) => db.doc(`bans/${u}`).get()));
    const info = {};
    uids.forEach((u, i) => {
      const d = us[i].exists ? us[i].data() : {};
      const bn = bans[i].exists ? bans[i].data() : null;
      info[u] = { name: d.nick || "Silinmiş hesap", code: d.code || "", banned: bn && bn.until > Date.now() ? bn.until : 0 };
    });
    // aynı kişi hakkındaki toplam şikâyet sayısı
    const counts = {};
    rows.forEach((r) => { counts[r.target] = (counts[r.target] || 0) + 1; });
    return json(200, {
      reports: rows.map((r) => ({
        id: r.id, at: r.at, reason: REPORT_REASONS[r.reason] || r.reason, note: r.note || "", msgs: Array.isArray(r.msgs) ? r.msgs.slice(0, 20) : [],
        ctx: r.ctx || "", by: info[r.by], target: { ...info[r.target], uid: r.target }, count: counts[r.target],
      })),
    });
  }
  if (act === "resolve") {
    const id = String(b.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return json(400, { error: "id" });
    const ref = db.doc(`reports/${id}`);
    const r = await ref.get();
    if (!r.exists) return json(404, { error: "report" });
    const verdict = b.verdict === "ban" ? "ban" : "dismiss";
    if (verdict === "ban") await setBan(db, r.data().target, b.days, REPORT_REASONS[r.data().reason] || "Kurallara aykırı davranış", uid);
    // aynı kişi hakkındaki diğer açık şikâyetleri de kapat
    const others = verdict === "ban" ? await db.collection("reports").where("target", "==", r.data().target).where("status", "==", "open").get() : { docs: [r] };
    const bt = db.batch();
    for (const d of others.docs) bt.update(d.ref, { status: verdict === "ban" ? "actioned" : "dismissed", resolvedBy: uid, resolvedAt: Date.now() });
    if (verdict !== "ban") bt.update(ref, { status: "dismissed", resolvedBy: uid, resolvedAt: Date.now() });
    await bt.commit();
    return json(200, { ok: true });
  }

  const code = String(b.code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return json(400, { error: "code" });
  const cs = await db.doc(`codes/${code}`).get();
  if (!cs.exists) return json(404, { error: "notfound" });
  const target = cs.data().uid;

  if (act === "lookup") {
    const [u, w, led, bn] = await Promise.all([
      db.doc(`users/${target}`).get(),
      db.doc(`wallets/${target}`).get(),
      db.collection("ledger").where("uid", "==", target).limit(200).get(),
      db.doc(`bans/${target}`).get(),
    ]);
    const ban = bn.exists && bn.data().until > Date.now() ? { until: bn.data().until, reason: bn.data().reason || "" } : null;
    const wl = w.exists ? w.data() : null;
    const lv = E.levelFromXp(wl?.xp || 0);
    const history = led.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 30);
    return json(200, {
      user: { code, name: u.exists ? u.data().nick || "" : "", joined: u.exists ? u.data().joined || 0 : 0 },
      wallet: wl ? { balance: wl.balance || 0, level: lv.level, xp: wl.xp || 0, wins: wl.wins || 0, games: wl.games || 0 } : null,
      history, ban,
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

  if (act === "ban") {
    if (target === uid) return json(400, { error: "self" });
    await setBan(db, target, b.days, String(b.reason || "Kurallara aykırı davranış").slice(0, 80), uid);
    return json(200, { ok: true });
  }
  if (act === "unban") {
    await db.doc(`bans/${target}`).delete();
    return json(200, { ok: true });
  }

  return json(400, { error: "action" });
};

// days: 1, 7, 30 → askıya alma; 0 → kalıcı yasak
async function setBan(db, target, days, reason, by) {
  const d = Math.floor(Number(days) || 0);
  const until = d > 0 ? Date.now() + Math.min(d, 3650) * 86400000 : FOREVER;
  await db.doc(`bans/${target}`).set({ until, reason, by, at: Date.now() });
}

export const config = { path: "/api/admin" };
