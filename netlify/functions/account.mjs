// Hesap silme (Play Store zorunluluğu). Kullanıcının profili, kimliği, anahtarları, mesajları, arkadaşlıkları,
// cüzdanı ve giriş hesabı silinir. Jeton hareket kayıtları (ledger) yasal saklama için kimliksiz bırakılır.
import { admin, json, requireUser } from "../lib/admin.mjs";

async function delQuery(db, q, extra) {
  let n = 0;
  for (;;) {
    const s = await q.limit(300).get();
    if (s.empty) break;
    const batch = db.batch();
    for (const d of s.docs) { batch.delete(d.ref); if (extra) await extra(d, batch); n++; }
    await batch.commit();
    if (s.size < 300) break;
  }
  return n;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  let b;
  try { b = await req.json(); } catch { b = {}; }
  if (b?.action !== "delete" || b?.confirm !== "SİL") return json(400, { error: "confirm" });
  const { db, auth } = admin();
  const stats = {};

  // Mesajlar ve şifreli medya parçaları
  stats.msgs = await delQuery(db, db.collection("msgs").where("members", "array-contains", uid));
  stats.blobs = await delQuery(db, db.collection("blobs").where("members", "array-contains", uid));
  stats.friends = await delQuery(db, db.collection("friends").where("members", "array-contains", uid));
  stats.blocks = await delQuery(db, db.collection("blocks").where("by", "==", uid));
  stats.calls = await delQuery(db, db.collection("calls").where("members", "array-contains", uid));
  stats.views = await delQuery(db, db.collection(`profile_views/${uid}/v`));
  stats.phones = await delQuery(db, db.collection("phones").where("uid", "==", uid));

  // Gruplardan çık
  const gs = await db.collection("groups").where("members", "array-contains", uid).get();
  for (const g of gs.docs) {
    const d = g.data();
    const members = (d.members || []).filter((x) => x !== uid);
    if (!members.length) { await g.ref.delete(); continue; }
    const admins = (d.admins || []).filter((x) => x !== uid);
    const upd = { members, admins: admins.length ? admins : [members[0]] };
    await g.ref.update(upd);
  }

  // Profil, TR ID, özel anahtarlar, cüzdan, rozet, durum
  const u = await db.doc(`users/${uid}`).get();
  const code = u.exists ? u.data().code : null;
  const priv = await db.collection(`private/${uid}/data`).get();
  const batch = db.batch();
  priv.docs.forEach((d) => batch.delete(d.ref));
  if (code) {
    const cs = await db.doc(`codes/${code}`).get();
    if (cs.exists && cs.data().uid === uid) batch.delete(cs.ref);
  }
  for (const p of [`users/${uid}`, `wallets/${uid}`, `badges/${uid}`, `statuses/${uid}`, `bans/${uid}`]) batch.delete(db.doc(p));
  await batch.commit();

  // Jeton kayıtları kimliksiz kalsın (muhasebe için tutar ve tarih saklanır)
  const led = await db.collection("ledger").where("uid", "==", uid).get();
  for (let i = 0; i < led.docs.length; i += 400) {
    const bt = db.batch();
    led.docs.slice(i, i + 400).forEach((d) => bt.update(d.ref, { uid: "silindi", by: null }));
    await bt.commit();
  }

  await db.collection("deletions").add({ at: Date.now(), msgs: stats.msgs || 0 });
  try { await auth.deleteUser(uid); } catch {}
  return json(200, { ok: true });
};

export const config = { path: "/api/account" };
