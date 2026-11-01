// Mesaj gönderildikten sonra istemci bu fonksiyonu çağırır.
// Fonksiyon mesajın gerçekten çağıranın olduğunu doğrular, alıcıların cihazlarına bildirim yollar.
// Mesaj içeriği uçtan uca şifreli olduğu için bildirimde içerik yer almaz, sadece gönderenin adı.
import { admin, json, requireUser, SITE } from "../lib/admin.mjs";

const recent = new Map(); // basit tekrar koruması (aynı mesaj için bir kez)

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "body" }); }
  const id = String(body?.id || "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return json(400, { error: "id" });
  if (recent.has(id)) return json(200, { ok: true, dup: true });
  recent.set(id, Date.now());
  if (recent.size > 2000) for (const [k, t] of recent) if (Date.now() - t > 600000) recent.delete(k);

  const { db, messaging } = admin();
  const snap = await db.doc(`msgs/${id}`).get();
  if (!snap.exists) return json(404, { error: "msg" });
  const m = snap.data();
  if (m.from !== uid) return json(403, { error: "owner" });
  if (Date.now() - (m.at || 0) > 5 * 60 * 1000) return json(200, { ok: true, old: true });

  const recipients = (m.members || []).filter((u) => u !== uid).slice(0, 50);
  if (!recipients.length) return json(200, { ok: true, sent: 0 });

  const [sender, group] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    m.gid ? db.doc(`groups/${m.gid}`).get() : Promise.resolve(null),
  ]);
  const senderName = (sender.exists && sender.data().nick) || "Biri";
  const groupName = group && group.exists ? group.data().name : null;
  const title = groupName || senderName;
  const text = groupName ? `${senderName}: yeni mesaj` : "Yeni mesaj";

  let sent = 0;
  const stale = [];
  await Promise.all(
    recipients.map(async (r) => {
      const ps = await db.doc(`private/${r}/data/push`).get();
      const tokens = ps.exists && Array.isArray(ps.data().tokens) ? ps.data().tokens.filter((t) => typeof t === "string").slice(-10) : [];
      if (!tokens.length) return;
      // Alıcı açısından sohbet kimliği: grupta "g:gid", birebirde gönderenin uid'si
      const conv = m.gid ? "g:" + m.gid : uid;
      const res = await messaging.sendEachForMulticast({
        tokens,
        data: { title, body: text, conv, url: `${SITE}/?c=${encodeURIComponent(conv)}` },
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
        android: { priority: "high" },
      });
      res.responses.forEach((x, i) => {
        if (x.success) sent++;
        else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(x.error?.code || "")) stale.push([r, tokens[i]]);
      });
    })
  );
  // Geçersiz cihaz jetonlarını temizle
  for (const [r, t] of stale) {
    const ref = db.doc(`private/${r}/data/push`);
    const cur = (await ref.get()).data()?.tokens || [];
    await ref.set({ tokens: cur.filter((x) => x !== t) }, { merge: true });
  }
  return json(200, { ok: true, sent });
};

export const config = { path: "/api/notify" };
