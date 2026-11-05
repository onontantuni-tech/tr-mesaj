// Ortak Firebase Admin kurulumu. Servis hesabı anahtarı Netlify ortam değişkeninden gelir
// (FIREBASE_SERVICE_ACCOUNT = Firebase'den indirilen JSON dosyasının tamamı). Kodda anahtar yok.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// Bildirim linkleri göreli: hangi alan adında yayınlanırsa orada açılır
export const SITE = "";

function init() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT tanımlı değil");
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

export const admin = () => {
  const app = init();
  return { auth: getAuth(app), db: getFirestore(app), messaging: getMessaging(app) };
};

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// İsteği yapan kullanıcıyı Firebase kimlik jetonundan doğrula
export async function requireUser(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  try {
    const { auth } = admin();
    const d = await auth.verifyIdToken(token);
    return d.uid;
  } catch {
    return null;
  }
}

// Türk cep numaraları 05xxxxxxxxx biçimine, diğerleri +ülkekodu biçimine getirilir
export function normPhone(v) {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+90")) d = "0" + d.slice(3);
  else if (d.startsWith("90") && d.length === 12) d = "0" + d.slice(2);
  else if (d.startsWith("5") && d.length === 10) d = "0" + d;
  if (/^05\d{9}$/.test(d)) return d;
  if (/^\+\d{8,15}$/.test(d)) return d;
  return null;
}
