// Gece ödülleri. Her gece Türkiye saatiyle 00:01'de çalıştırılır.
//  - Dünün sıralamasında ilk 3'e günlük ödül
//  - Ayın 1'iyse, geçen ayın sıralamasında ilk 3'e aylık ödül
// Aynı ödül iki kez verilmez (rewards/{tür}_{dönem} belgesi kontrol edilir).
// Çağrı CRON_SECRET ile korunur (Vercel Cron bu başlığı kendisi gönderir).
import { admin, json } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";

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

export default async (req) => {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) return json(401, { error: "auth" });
  const { db } = admin();
  // "Dün" = şu andan 10 dakika önce Türkiye saatine göre gün (00:01'de çalışınca bir önceki gün)
  const y = E.trDate(Date.now() - 10 * 60 * 1000);
  const today = E.trDate();
  const out = [await payTop(db, "day", y.day, E.DAILY_PRIZES)];
  if (today.dom === 1) out.push(await payTop(db, "month", y.month, E.MONTHLY_PRIZES));
  return json(200, { ok: true, out });
};

export const config = { path: "/api/cron" };
