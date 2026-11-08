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
  const full = await isAdmin(db, uid);
  // Moderatörler: şikâyet inceleme, en fazla 7 gün askıya alma, kullanıcı bakma ve not
  const mod = !full && (await db.doc(`mods/${uid}`).get()).exists;
  if (!full && !mod) return json(403, { error: "admin" });
  let b;
  try { b = await req.json(); } catch { b = {}; }
  const act = String(b?.action || "check");
  if (mod && !["check", "reports", "resolve", "lookup", "ban", "unban", "note"].includes(act)) return json(403, { error: "mod" });
  if (mod && (act === "ban" || (act === "resolve" && b.verdict === "ban")) && !(Number(b.days) > 0 && Number(b.days) <= 7)) return json(403, { error: "modban" });
  if (act === "check") {
    if (mod) return json(200, { admin: true, mod: true, house: null });
    const h = await db.doc("house/stats").get();
    return json(200, { admin: true, house: h.exists ? h.data() : { net: 0, rake: 0, botWin: 0, botStake: 0, hands: 0 } });
  }
  // Hediye kodu oluştur (ör. kampanya, telafi): kod başına jeton ve kullanım sayısı
  if (act === "mkcode") {
    const amount = Math.trunc(Number(b.amount)), uses = Math.max(1, Math.min(10000, Math.trunc(Number(b.uses) || 1)));
    if (!(amount > 0 && amount <= 10000000)) return json(400, { error: "amount" });
    let code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    if (code.length < 5) { code = ""; for (let i = 0; i < 8; i++) code += "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]; }
    await db.doc(`giftcodes/${code}`).set({ amount, uses, used: 0, by: uid, at: Date.now() });
    return json(200, { ok: true, code });
  }
  // Olağan dışı jeton hareketleri (son 24 saat, 1.000.000 ve üzeri)
  if (act === "alerts") {
    const q = await db.collection("ledger").where("at", ">", Date.now() - 86400000).orderBy("at", "desc").limit(1500).get();
    const big = q.docs.map((d) => d.data()).filter((x) => Math.abs(x.delta || 0) >= 1000000).slice(0, 100);
    const per = {}; q.docs.forEach((d) => { const x = d.data(); per[x.uid] = (per[x.uid] || 0) + (x.delta || 0); });
    const top = Object.entries(per).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15);
    const uids = [...new Set([...big.map((x) => x.uid), ...top.map((x) => x[0])])].slice(0, 60);
    const us = await Promise.all(uids.map((u) => db.doc(`users/${u}`).get()));
    const names = {}; uids.forEach((u, i) => { names[u] = us[i].exists ? { name: us[i].data().nick || "", code: us[i].data().code || "" } : { name: "?", code: "" }; });
    return json(200, { big, top, names });
  }
  // Kasa raporu (CSV için ham satırlar)
  if (act === "houseRows") {
    const since = Date.now() - Math.max(1, Math.min(90, Number(b.days) || 30)) * 86400000;
    const q = await db.collection("house_ledger").where("at", ">", since).orderBy("at", "desc").limit(5000).get();
    return json(200, { rows: q.docs.map((d) => d.data()) });
  }
  // Moderatör ekle / çıkar (TR ID ile)
  if (act === "mod") {
    const code = String(b.code || "").replace(/\D/g, "");
    const cs = await db.doc(`codes/${code}`).get();
    if (!cs.exists) return json(404, { error: "notfound" });
    const t = cs.data().uid;
    if (b.on) await db.doc(`mods/${t}`).set({ by: uid, at: Date.now() }); else await db.doc(`mods/${t}`).delete();
    return json(200, { ok: true });
  }

  // Şikâyetler
  // Uygulama içi duyuru / bakım bandı (herkes görür)
  if (act === "notice") {
    const text = String(b.text || "").slice(0, 300).trim();
    const kind = b.kind === "maint" ? "maint" : "info";
    await db.doc("config/app").set({ notice: text ? { text, kind, at: Date.now() } : null }, { merge: true });
    return json(200, { ok: true });
  }
  // Mevsimlik etkinlik: günlük hediye çarpanı (1–3) ve süre (gün)
  if (act === "event") {
    const mul = Math.max(1, Math.min(3, Number(b.mul) || 1)), days = Math.max(0, Math.min(30, Number(b.days) || 0));
    const ev = days ? { name: String(b.name || "Etkinlik").slice(0, 40), mul, until: Date.now() + days * 86400000 } : null;
    await db.doc("config/app").set({ event: ev }, { merge: true });
    return json(200, { ok: true, event: ev });
  }
  if (act === "stats") {
    const day = Date.now() - 86400000;
    const [errs, fb] = await Promise.all([
      db.collection("errors").where("at", ">", day).limit(200).get(),
      db.collection("feedback").limit(500).get(),
    ]);
    const votes = {}; fb.docs.forEach((d) => { const v = d.data().vote; if (v) votes[v] = (votes[v] || 0) + 1; });
    return json(200, { errors24h: errs.size, lastErrors: errs.docs.slice(0, 20).map((d) => d.data()), votes, feedback: fb.docs.map((d) => d.data()).filter((x) => x.text).slice(0, 50) });
  }
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
    const [u, w, led, bn, nt] = await Promise.all([
      db.doc(`users/${target}`).get(),
      db.doc(`wallets/${target}`).get(),
      db.collection("ledger").where("uid", "==", target).limit(200).get(),
      db.doc(`bans/${target}`).get(),
      db.collection(`adminNotes/${target}/n`).orderBy("at", "desc").limit(20).get(),
    ]);
    const ban = bn.exists && bn.data().until > Date.now() ? { until: bn.data().until, reason: bn.data().reason || "" } : null;
    const wl = w.exists ? w.data() : null;
    const lv = E.levelFromXp(wl?.xp || 0);
    const history = led.docs.map((d) => d.data()).sort((a, b) => b.at - a.at).slice(0, 30);
    return json(200, {
      user: { code, name: u.exists ? u.data().nick || "" : "", joined: u.exists ? u.data().joined || 0 : 0 },
      wallet: wl ? { balance: wl.balance || 0, level: lv.level, xp: wl.xp || 0, wins: wl.wins || 0, games: wl.games || 0 } : null,
      history, ban, notes: nt.docs.map((d) => d.data()),
    });
  }

  // Elle VIP verme (Play Store ödemesi bağlanana kadar ya da destek için)
  if (act === "grantVip") {
    const until = await db.runTransaction(async (tx) => {
      const ref = db.doc(`wallets/${target}`);
      const s = await tx.get(ref);
      const w = s.exists ? s.data() : E.newWallet();
      E.grantVip(w);
      tx.set(db.collection("ledger").doc(), { uid: target, delta: 0, reason: `VIP verildi (${E.VIP.days} gün)`, by: uid, at: Date.now(), after: w.balance || 0 });
      tx.set(ref, w);
      tx.set(db.doc(`badges/${target}`), { vipUntil: w.vipUntil }, { merge: true });
      return w.vipUntil;
    });
    return json(200, { ok: true, vipUntil: until });
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

  // Yönetici iç notu (sadece yöneticiler görür)
  if (act === "note") {
    const text = String(b.text || "").slice(0, 1000);
    await db.collection(`adminNotes/${target}/n`).add({ text, by: uid, at: Date.now() });
    return json(200, { ok: true });
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
