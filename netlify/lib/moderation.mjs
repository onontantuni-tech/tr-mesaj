// Askıya alma / yasak: bans/{uid} {until, reason, by, at}. until = Number.MAX_SAFE_INTEGER kalıcı yasak demek.
export const FOREVER = 8640000000000000;

export async function activeBan(db, uid) {
  const s = await db.doc(`bans/${uid}`).get();
  if (!s.exists) return null;
  const b = s.data();
  return (b.until || 0) > Date.now() ? b : null;
}

export const REPORT_REASONS = { taciz: "Taciz / hakaret", spam: "Spam / dolandırıcılık", uygunsuz: "Uygunsuz içerik", hile: "Oyunda hile", diger: "Diğer" };
