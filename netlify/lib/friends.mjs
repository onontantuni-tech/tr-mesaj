// Arkadaşlık: friends/{küçükUid_büyükUid} belgesi. Mesaj ve arama sadece status=="accepted" iken mümkün.
export const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export async function areFriends(db, a, b) {
  const s = await db.doc(`friends/${pairId(a, b)}`).get();
  return s.exists && s.data().status === "accepted";
}

// Eski kullanıcılar için bir kerelik: daha önce birebir yazıştığı herkesle otomatik arkadaş yap.
export async function migrateFriends(db, uid) {
  const q = await db.collection("msgs").where("members", "array-contains", uid).get();
  const peers = new Set();
  q.docs.forEach((d) => {
    const m = d.data();
    if (m.gid || typeof m.to !== "string") return;
    const p = m.from === uid ? m.to : m.from;
    if (p && p !== uid) peers.add(p);
  });
  let made = 0;
  for (const p of peers) {
    const id = pairId(uid, p);
    const ref = db.doc(`friends/${id}`);
    const s = await ref.get();
    if (s.exists && s.data().status === "accepted") continue;
    const members = uid < p ? [uid, p] : [p, uid];
    await ref.set({ members, from: uid, to: p, status: "accepted", at: Date.now(), auto: true });
    made++;
  }
  return made;
}
