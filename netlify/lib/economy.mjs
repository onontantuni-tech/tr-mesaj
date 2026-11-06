// Jeton ekonomisi: sabitler ve yardımcılar. Bakiye sadece sunucuda değişir.
// Jeton paraya çevrilemez ve kullanıcılar arasında gönderilemez.
import { FieldValue } from "firebase-admin/firestore";

export const WELCOME_BONUS = 100000;

// Mağaza paketleri (ödeme Play Store faturalandırması bağlanınca açılacak)
export const PACKAGES = [
  { id: "p1", coins: 100000, price: 99 },
  { id: "p2", coins: 300000, price: 199 },
  { id: "p3", coins: 500000, price: 399 },
  { id: "p4", coins: 800000, price: 499 },
  { id: "p5", coins: 1600000, price: 899 },
  { id: "p6", coins: 3000000, price: 1500 },
  { id: "p7", coins: 6000000, price: 2500 },
];

// Masa ücretleri ve açılması için gereken seviye
export const STAKES = [
  { v: 0, lvl: 1 }, { v: 1000, lvl: 1 }, { v: 5000, lvl: 1 }, { v: 10000, lvl: 2 },
  { v: 50000, lvl: 3 }, { v: 100000, lvl: 5 }, { v: 500000, lvl: 8 }, { v: 1000000, lvl: 12 },
];
export const stakeAllowed = (v, level) => STAKES.some((s) => s.v === v && level >= s.lvl);

// Ödüller: sıralamada ilk 3
export const DAILY_PRIZES = [100000, 50000, 20000];
export const MONTHLY_PRIZES = [1000000, 500000, 200000];

// Desenler: masa (felt) ve ıstaka. Fiyat jeton.
export const SKINS = {
  table: [
    { id: "yesil", name: "Klasik yeşil", price: 0 },
    { id: "lacivert", name: "Gece mavisi", price: 50000 },
    { id: "bordo", name: "Bordo kadife", price: 75000 },
    { id: "siyah", name: "Siyah deri", price: 120000 },
    { id: "ay", name: "Ay yıldız", price: 250000 },
  ],
  rack: [
    { id: "ceviz", name: "Ceviz", price: 0 },
    { id: "abanoz", name: "Abanoz", price: 60000 },
    { id: "kiraz", name: "Kiraz", price: 60000 },
    { id: "altin", name: "Altın varak", price: 300000 },
  ],
};

// Seviye: XP eşiği, seviye arttıkça bir sonrakine daha çok XP gerekir
export const XP_WIN = 100, XP_PLAY = 20;
export function levelFromXp(xp) {
  let lvl = 1, need = 200, acc = 0;
  while (xp >= acc + need && lvl < 50) { acc += need; lvl++; need = Math.round(need * 1.35); }
  return { level: lvl, cur: xp - acc, next: need };
}
// Seviyeye göre bilgisayar zorluğu: 0 kolay, 1 orta, 2 zor
export const botSkillForLevel = (lvl) => (lvl >= 10 ? 2 : lvl >= 4 ? 1 : 0);

// Türkiye saatine göre gün ve ay anahtarları (UTC+3, yaz saati yok)
export function trDate(ms = Date.now()) {
  const d = new Date(ms + 3 * 3600 * 1000);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, "0"), day = String(d.getUTCDate()).padStart(2, "0");
  return { day: `${y}${m}${day}`, month: `${y}${m}`, dom: d.getUTCDate() };
}

export function newWallet() {
  return { balance: WELCOME_BONUS, xp: 0, wins: 0, games: 0, owned: { table: ["yesil"], rack: ["ceviz"] }, skin: { table: "yesil", rack: "ceviz" }, createdAt: Date.now() };
}

// İşlem (transaction) içinde bakiye değiştir ve deftere yaz
export function credit(tx, db, uid, wallet, delta, reason, by = "system") {
  wallet.balance = Math.max(0, (wallet.balance || 0) + delta);
  tx.set(db.collection("ledger").doc(), { uid, delta, reason, by, at: Date.now(), after: wallet.balance });
}

// Oyun sonucu istatistikleri: sıralama sayaçları (işlem içinde)
export function addStats(tx, db, uid, points, won) {
  const { day, month } = trDate();
  const inc = { points: FieldValue.increment(points), wins: FieldValue.increment(won ? 1 : 0), games: FieldValue.increment(1), uid };
  tx.set(db.doc(`lb_day/${day}/u/${uid}`), inc, { merge: true });
  tx.set(db.doc(`lb_month/${month}/u/${uid}`), inc, { merge: true });
}
