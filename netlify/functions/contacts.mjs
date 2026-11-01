// Rehberden bul: istemci seçtiği numaraları gönderir, fonksiyon hangilerinin TR'de olduğunu söyler.
// Numaralar kaydedilmez. "phones" koleksiyonu istemcilere kapalıdır, sadece bu fonksiyon okur.
import { admin, json, requireUser, normPhone } from "../lib/admin.mjs";

const calls = new Map(); // kullanıcı başına basit hız sınırı

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });

  const now = Date.now();
  const c = (calls.get(uid) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (c.length >= 20) return json(429, { error: "rate" });
  c.push(now);
  calls.set(uid, c);

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "body" }); }
  const list = Array.isArray(body?.phones) ? body.phones.slice(0, 1000) : [];
  // Gelen sıradaki indeksleri koru ki istemci kendi rehber adını eşleştirebilsin
  const norm = list.map((p) => normPhone(p));
  const uniq = [...new Set(norm.filter(Boolean))];
  if (!uniq.length) return json(200, { matches: [] });

  const { db } = admin();
  const found = {};
  for (let i = 0; i < uniq.length; i += 300) {
    const refs = uniq.slice(i, i + 300).map((p) => db.doc(`phones/${p.replace("+", "p")}`));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, k) => {
      if (s.exists && s.data().uid && s.data().uid !== uid) found[uniq[i + k]] = s.data().uid;
    });
  }
  const matches = [];
  norm.forEach((p, idx) => { if (p && found[p]) matches.push({ i: idx, uid: found[p] }); });
  return json(200, { matches });
};

export const config = { path: "/api/contacts" };
