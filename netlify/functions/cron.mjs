// Gece ödülleri. Her gece Türkiye saatiyle 00:01'de çalıştırılır.
//  - Dünün sıralamasında ilk 3'e günlük ödül
//  - Ayın 1'iyse, geçen ayın sıralamasında ilk 3'e aylık ödül
// Aynı ödül iki kez verilmez (rewards/{tür}_{dönem} belgesi kontrol edilir).
// Çağrı CRON_SECRET ile korunur (Vercel Cron bu başlığı kendisi gönderir).
import { admin, json } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";
import { FieldValue, FieldPath } from "firebase-admin/firestore";

async function payTop(db, kind, period, prizes) {
  const flag = db.doc(`rewards/${kind}_${period}`);
  if ((await flag.get()).exists) return { kind, period, skipped: true };
  const col = kind === "day" ? `lb_day/${period}/u` : `lb_month/${period}/u`;
  const top = await db.collection(col).orderBy("points", "desc").limit(10).get();
  const ranked = top.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((x) => (x.points || 0) > 0)
    .sort((a, b) => (b.points - a.points) || ((b.wins || 0) - (a.wins || 0))).slice(0, prizes.length);
  const paid = [];
  await db.runTransaction(async (tx) => {
    if ((await tx.get(flag)).exists) return;
    const ws = await Promise.all(ranked.map((r) => tx.get(db.doc(`wallets/${r.uid}`))));
    ranked.forEach((r, i) => {
      const w = ws[i].exists ? ws[i].data() : E.newWallet();
      const label = kind === "day" ? `Günün ${i + 1}.si ödülü (${period})` : `Ayın ${i + 1}.si ödülü (${period})`;
      E.credit(tx, db, r.uid, w, prizes[i], label);
      tx.set(db.doc(`wallets/${r.uid}`), w);
      paid.push({ uid: r.uid, rank: i + 1, amount: prizes[i] });
    });
    tx.set(flag, { at: Date.now(), paid });
  });
  return { kind, period, paid };
}

// Yarım kalmış oyunlar: 2 saattir hamle yoksa masa ücretleri sahiplerine iade edilir
async function refundStale(db) {
  const q = await db.collection("games").where("status", "==", "play").limit(300).get();
  const stale = q.docs.filter((d) => Date.now() - (d.data().lastMoveAt || d.data().updatedAt || 0) > 2 * 3600e3);
  let n = 0;
  for (const d of stale) {
    await db.runTransaction(async (tx) => {
      const gs = await tx.get(d.ref);
      const g = gs.data();
      if (!g || g.status !== "play") return;
      const paid = g.paid || [];
      const ws = await Promise.all(paid.map((u) => tx.get(db.doc(`wallets/${u}`))));
      paid.forEach((u, i) => {
        if (!ws[i].exists || !g.stake) return;
        const w = ws[i].data();
        E.credit(tx, db, u, w, g.stake, g.type === "pool" ? "Yarım kalan bilardo: masa ücreti iadesi" : "Yarım kalan okey: masa ücreti iadesi");
        tx.set(db.doc(`wallets/${u}`), w);
      });
      tx.update(d.ref, { status: "over", aborted: true, settled: true, pot: 0, winner: null, log: "Oyun yarım kaldı, masa ücretleri iade edildi", updatedAt: Date.now() });
      n++;
    });
  }
  return { kind: "refund", games: n };
}

// Kaybolan mesajlar: süresi dolan mesajları ve şifreli medya parçalarını sil
async function purgeExpired(db) {
  const q = await db.collection("msgs").where("exp", "<", Date.now()).limit(400).get();
  let n = 0, blobs = 0;
  for (const d of q.docs) {
    const bq = await db.collection("blobs").where(FieldPath.documentId(), ">=", d.id + "_").where(FieldPath.documentId(), "<", d.id + "_~").limit(200).get().catch(() => null);
    const mine = bq ? bq.docs : [];
    const batch = db.batch();
    mine.forEach((x) => batch.delete(x.ref)); blobs += mine.length;
    batch.delete(d.ref); n++;
    await batch.commit();
  }
  return { kind: "purge", msgs: n, blobs };
}

// Akşam turnuvası ödülleri (gece 00:01'de dünün turnuvası)
async function settleTour(db, day) {
  const flag = db.doc(`rewards/tour_${day}`);
  if ((await flag.get()).exists) return { kind: "tour", day, skipped: true };
  const q = await db.collection(`tour/${day}/p`).get();
  const all = q.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const n = all.length;
  const ranked = all.filter((x) => (x.points || 0) > 0).sort((a, b) => (b.points - a.points) || ((b.wins || 0) - (a.wins || 0)) || ((a.at || 0) - (b.at || 0)));
  // Katılımcı sayısı 3'ün altındaysa ya da kimse puan almadıysa ücretler iade edilir
  const refund = n < 3 || !ranked.length;
  const gross = n * E.TOUR.fee, rake = refund ? 0 : Math.round(gross * E.RAKE), pool = gross - rake;
  const paid = [];
  const pay = async (uid, amount, label, rank) => db.runTransaction(async (tx) => {
    const ref = db.doc(`wallets/${uid}`); const ws = await tx.get(ref); const w = ws.exists ? ws.data() : E.newWallet();
    if (w.tourPaid === day) return;
    w.tourPaid = day; w.lastTour = { day, rank, of: n, amount, refund };
    if (amount) E.credit(tx, db, uid, w, amount, label);
    tx.set(ref, w);
  });
  if (refund) { for (const p of all) { await pay(p.uid, E.TOUR.fee, `Akşam turnuvası iadesi (${day})`, 0); paid.push({ uid: p.uid, amount: E.TOUR.fee }); } }
  else {
    const shares = E.TOUR.split.slice(0, ranked.length); const tot = shares.reduce((a, x) => a + x, 0);
    for (let i = 0; i < ranked.length; i++) {
      const amt = i < shares.length ? Math.floor(pool * shares[i] / tot) : 0;
      await pay(ranked[i].uid, amt, `Akşam turnuvası ${i + 1}.lik ödülü (${day})`, i + 1);
      if (amt) paid.push({ uid: ranked[i].uid, rank: i + 1, amount: amt });
    }
    for (const p of all.filter((x) => !(x.points > 0))) await pay(p.uid, 0, "", 0);
    await db.doc("house/stats").set({ net: FieldValue.increment(rake), rake: FieldValue.increment(rake) }, { merge: true });
  }
  await flag.set({ at: Date.now(), n, pool, rake, refund, paid });
  return { kind: "tour", day, n, pool, refund };
}

// Haftalık lig kapanışı (pazartesi gecesi): ödüller, yükselme ve düşme
async function settleLeague(db, wk) {
  const flag = db.doc(`rewards/league_${wk}`);
  if ((await flag.get()).exists) return { kind: "league", week: wk, skipped: true };
  const summary = [];
  for (let tier = 0; tier < E.LEAGUES.length; tier++) {
    const q = await db.collection(`lb_week/${wk}/t${tier}`).orderBy("points", "desc").limit(2000).get();
    const rows = q.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((x) => (x.points || 0) > 0)
      .sort((a, b) => (b.points - a.points) || ((b.wins || 0) - (a.wins || 0)));
    const n = rows.length;
    const up = tier < E.LEAGUES.length - 1 ? Math.max(1, Math.ceil(n * E.LEAGUE_MOVE)) : 0;
    const down = tier > 0 && n >= 5 ? Math.ceil(n * E.LEAGUE_MOVE) : 0;
    const L = E.LEAGUES[tier];
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const move = i < up ? 1 : i >= n - down ? -1 : 0;
      const prize = L.prizes[i] || 0;
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`wallets/${r.uid}`);
        const ws = await tx.get(ref);
        const w = ws.exists ? ws.data() : E.newWallet();
        if (w.leagueDone === wk) return;
        w.leagueDone = wk;
        w.league = Math.max(0, Math.min(E.LEAGUES.length - 1, tier + move));
        w.lastLeague = { week: wk, tier, rank: i + 1, of: n, move, prize };
        if (prize) E.credit(tx, db, r.uid, w, prize, `${L.name} ligi ${i + 1}.lik ödülü`);
        tx.set(ref, w);
      });
    }
    summary.push({ tier, players: n, up: Math.min(up, n), down });
  }
  await flag.set({ at: Date.now(), summary });
  return { kind: "league", week: wk, summary };
}

export default async (req) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) return json(401, { error: "auth" });
  const { db } = admin();
  // "Dün" = şu andan 10 dakika önce Türkiye saatine göre gün (00:01'de çalışınca bir önceki gün)
  const y = E.trDate(Date.now() - 10 * 60 * 1000);
  const today = E.trDate();
  const out = [await payTop(db, "day", y.day, E.DAILY_PRIZES)];
  out.push(await settleTour(db, y.day));
  if (today.dom === 1) out.push(await payTop(db, "month", y.month, E.MONTHLY_PRIZES));
  if (today.dow === 0) out.push(await settleLeague(db, E.weekId(Date.now() - 10 * 60 * 1000)));
  out.push(await refundStale(db));
  try { out.push(await purgeExpired(db)); } catch (e) { out.push({ kind: "purge", error: String(e.message || e).slice(0, 100) }); }
  return json(200, { ok: true, out });
};

export const config = { path: "/api/cron" };
