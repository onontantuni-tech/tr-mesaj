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

// Salonlar: jeton bakiyesine göre açılır. Oyuncu kendi salonuna ve alttakilere girebilir.
export const TIERS = [
  { id: "caylak", name: "Çaylak Salonu", icon: "🌱", min: 0, stakes: [0, 1000, 2500, 5000] },
  { id: "kahve", name: "Kahvehane", icon: "☕", min: 100000, stakes: [10000, 20000, 30000] },
  { id: "usta", name: "Ustalar Salonu", icon: "🎯", min: 300000, stakes: [50000, 75000, 100000] },
  { id: "kral", name: "Kral Salonu", icon: "👑", min: 600000, stakes: [150000, 200000, 250000] },
  { id: "sultan", name: "Sultan Salonu", icon: "🏰", min: 1000000, stakes: [300000, 500000, 1000000] },
];
export const tierIndex = (balance) => { let i = 0; TIERS.forEach((t, k) => { if ((balance || 0) >= t.min) i = k; }); return i; };
export const stakeAllowed = (v, balance) => TIERS.some((t, k) => k <= tierIndex(balance) && t.stakes.includes(v)) && (balance || 0) >= v;
// Kasa kesintisi: her elde potun %5'i
export const RAKE = 0.05;
export const COMEBACK = 20000; // 7+ gün aradan sonra dönene

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
    { id: "vip_mor", name: "Kraliyet moru", price: 0, vip: true },
    { id: "vip_mermer", name: "Beyaz mermer", price: 0, vip: true },
    { id: "vip_altin", name: "Altın işlemeli", price: 0, vip: true },
  ],
  rack: [
    { id: "ceviz", name: "Ceviz", price: 0 },
    { id: "abanoz", name: "Abanoz", price: 60000 },
    { id: "kiraz", name: "Kiraz", price: 60000 },
    { id: "altin", name: "Altın varak", price: 300000 },
    { id: "vip_sedef", name: "Sedef kakma", price: 0, vip: true },
    { id: "vip_elmas", name: "Elmas", price: 0, vip: true },
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
  return { day: `${y}${m}${day}`, month: `${y}${m}`, dom: d.getUTCDate(), dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() };
}

// ---- Haftalık lig: Bronz → Gümüş → Altın → Elmas. Hafta pazartesi 00:00 (TR) başlar. ----
// Her ligde haftanın ilk %20'si bir üst lige çıkar, son %20'si (en az 5 oyuncu varsa) bir alt lige düşer.
// Her ligin ilk 3'üne ödül. Puan: galibiyet = oyun puanı (jetonlu masada 2 katı), mağlubiyet = 1 katılım puanı.
// Bilgisayara karşı ücretsiz masalar lig puanı vermez.
export const LEAGUES = [
  { id: "bronz", name: "Bronz", icon: "🥉", prizes: [20000, 10000, 5000] },
  { id: "gumus", name: "Gümüş", icon: "🥈", prizes: [50000, 25000, 10000] },
  { id: "altin", name: "Altın", icon: "🥇", prizes: [100000, 50000, 25000] },
  { id: "elmas", name: "Elmas", icon: "💎", prizes: [250000, 125000, 50000] },
];
export const LEAGUE_MOVE = 0.2;
export function weekId(ms = Date.now()) {
  const d = trDate(ms);
  return trDate(ms - d.dow * 86400000).day;
}
export function leaguePoints({ won, draw, stake, opp, points }) {
  if (!(stake > 0) && !(opp && opp.length)) return 0;
  if (draw) return 1;
  return won ? (points || 2) * (stake > 0 ? 2 : 1) : 1;
}
// ---- Akşam turnuvası: her gün 20:00–23:00 (TR). Katılım ücreti ödenir, pencere içindeki oyunlar puan getirir.
// Ödül havuzu = katılım ücretleri (%5 kasa kesintisiyle); ilk 3'e %50 / %30 / %20.
export const TOUR = { fee: 10000, start: 20, end: 23, joinUntil: 22, split: [0.5, 0.3, 0.2] };
export function tourOpen(ms = Date.now()) { const h = trDate(ms).hour; return h >= TOUR.start && h < TOUR.end; }
export function addTour(tx, db, uid, wl, pts, won) {
  const d = trDate();
  if (!pts || wl.tourDay !== d.day || !tourOpen()) return;
  tx.set(db.doc(`tour/${d.day}/p/${uid}`), { points: FieldValue.increment(pts), wins: FieldValue.increment(won ? 1 : 0), games: FieldValue.increment(1) }, { merge: true });
}
// ---- Kulüpler (kahvehaneler): en çok 30 üye; üyelerin lig puanları kulübün haftalık puanına eklenir ----
export const CLUB = { price: 50000, max: 30, icons: ["☕", "🦅", "🐺", "🦁", "⚓", "🌙", "🔥", "⚡", "🎯", "👑", "🍀", "🏰"] };
export function addClub(tx, db, wl, pts) {
  if (!pts || !wl.club) return;
  tx.set(db.doc(`club_week/${weekId()}/c/${wl.club}`), { points: FieldValue.increment(pts) }, { merge: true });
}
export function addLeague(tx, db, uid, wl, pts, won) {
  if (!pts) return;
  const wk = weekId(), tier = Math.max(0, Math.min(LEAGUES.length - 1, wl.league || 0));
  if (wl.leagueWeek !== wk) { wl.leagueWeek = wk; wl.leagueTier = tier; }
  tx.set(db.doc(`lb_week/${wk}/t${wl.leagueTier ?? tier}/${uid}`), { points: FieldValue.increment(pts), wins: FieldValue.increment(won ? 1 : 0), games: FieldValue.increment(1), uid }, { merge: true });
}

// Sadakat: her gün ilk girişte o günün hediyesi. 30 günlük takvim, bir gün kaçırılırsa 1. güne döner.
// 30. gün ayrıca 3 günlük VIP hediye edilir. Sonra takvim baştan başlar.
export const LOGIN_CALENDAR = [
  2000, 3000, 4000, 5000, 6000, 8000, 25000,
  3000, 4000, 5000, 6000, 8000, 10000, 40000,
  4000, 5000, 6000, 8000, 10000, 12000, 50000,
  5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 100000,
];
export const LOGIN_VIP_DAYS = 3;
// Saatlik sandık, jeton desteği, günlük çark
export const CHEST = { every: 4 * 3600 * 1000, amount: 2000 };
export const RESCUE = { below: 1000, amount: 10000 };
export const WHEEL = [
  { amount: 1000, w: 30 }, { amount: 2000, w: 25 }, { amount: 3000, w: 18 }, { amount: 5000, w: 12 },
  { amount: 10000, w: 8 }, { amount: 25000, w: 4 }, { amount: 50000, w: 2 }, { amount: 100000, w: 1 },
];
// Arkadaşını çağır: davet edilen ilk oyununu bitirince davet edene verilir
export const REFERRAL_BONUS = 100000;

// VIP: 30 gün. Jetonla alınır (Play Store'da parayla da satılabilir).
export const VIP = { price: 250000, days: 30 };
export const isVip = (w, now = Date.now()) => (w?.vipUntil || 0) > now;

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

// ---- Oyun sonrası: istatistik, seri bonusu, günlük görev sayaçları, oyun geçmişi ----
export const STREAK_BONUS = { every: 3, amount: 5000 };
export const TASKS = [
  { id: "play3", text: "3 oyun oyna", need: (t) => t.played >= 3, goal: (t) => [t.played, 3], prize: 3000 },
  { id: "win1", text: "1 oyun kazan", need: (t) => t.won >= 1, goal: (t) => [t.won, 1], prize: 5000 },
  { id: "okey1", text: "1 el Okey oyna", need: (t) => t.okey >= 1, goal: (t) => [t.okey, 1], prize: 2000 },
  { id: "pool1", text: "1 Bilardo oyna", need: (t) => t.pool >= 1, goal: (t) => [t.pool, 1], prize: 2000 },
  { id: "win3", text: "3 oyun kazan", need: (t) => t.won >= 3, goal: (t) => [t.won, 3], prize: 15000 },
];
export function todayTasks(w) {
  const day = trDate().day;
  return w.td && w.td.day === day ? w.td : { day, played: 0, won: 0, okey: 0, pool: 0, claimed: [] };
}
// ---- Sanal hediyeler ----
export const GIFTS = [
  { id: "cay", icon: "☕", name: "Çay", price: 500 },
  { id: "gul", icon: "🌹", name: "Gül", price: 2000 },
  { id: "pasta", icon: "🎂", name: "Pasta", price: 5000 },
  { id: "kupa", icon: "🏆", name: "Kupa", price: 15000 },
  { id: "tac", icon: "👑", name: "Taç", price: 25000 },
  { id: "elmas", icon: "💎", name: "Elmas", price: 100000 },
];

// ---- Başarımlar: bir kez kazanılır, küçük jeton ödülü verir, profilde rozet olarak görünür ----
export const ACH = [
  { id: "w1", icon: "🥇", name: "İlk zafer", desc: "İlk oyununu kazan", prize: 2000, t: (w) => (w.wins || 0) >= 1 },
  { id: "w10", icon: "🎖️", name: "Kazanmaya alıştı", desc: "10 oyun kazan", prize: 5000, t: (w) => (w.wins || 0) >= 10 },
  { id: "w100", icon: "🏅", name: "Usta", desc: "100 oyun kazan", prize: 25000, t: (w) => (w.wins || 0) >= 100 },
  { id: "w1000", icon: "🏆", name: "Efsane", desc: "1000 oyun kazan", prize: 100000, t: (w) => (w.wins || 0) >= 1000 },
  { id: "g10", icon: "🎮", name: "Isınma turu", desc: "10 oyun oyna", prize: 2000, t: (w) => (w.games || 0) >= 10 },
  { id: "g100", icon: "🕹️", name: "Müdavim", desc: "100 oyun oyna", prize: 10000, t: (w) => (w.games || 0) >= 100 },
  { id: "g1000", icon: "☕", name: "Kahvehane demirbaşı", desc: "1000 oyun oyna", prize: 50000, t: (w) => (w.games || 0) >= 1000 },
  { id: "s3", icon: "🔥", name: "Seri", desc: "Üst üste 3 oyun kazan", prize: 5000, t: (w) => (w.maxStreak || 0) >= 3 },
  { id: "s10", icon: "⚡", name: "Durdurulamaz", desc: "Üst üste 10 oyun kazan", prize: 30000, t: (w) => (w.maxStreak || 0) >= 10 },
  { id: "okey1", icon: "🀄", name: "Okey bitirdi", desc: "Bir Okey eli kazan", prize: 3000, t: (w) => (w.tw?.okey || 0) >= 1 },
  { id: "pool1", icon: "🎱", name: "Siyahı soktu", desc: "Bir Bilardo oyunu kazan", prize: 3000, t: (w) => (w.tw?.pool || 0) >= 1 },
  { id: "pisti1", icon: "🃏", name: "Kart ustası", desc: "Bir Pişti eli kazan", prize: 3000, t: (w) => (w.tw?.pisti || 0) >= 1 },
  { id: "tavla1", icon: "🎲", name: "Zarlar benden yana", desc: "Bir Tavla oyunu kazan", prize: 3000, t: (w) => (w.tw?.tavla || 0) >= 1 },
  { id: "mars", icon: "💥", name: "Mars!", desc: "Tavlada rakibini mars et", prize: 5000, t: (w) => (w.marsN || 0) >= 1 },
  { id: "all4", icon: "🌟", name: "Çok yönlü", desc: "Dört oyunun hepsinde kazan", prize: 20000, t: (w) => ["okey", "pool", "pisti", "tavla"].every((k) => (w.tw?.[k] || 0) >= 1) },
  { id: "gift1", icon: "🎁", name: "Gönlü zengin", desc: "Bir arkadaşına hediye gönder", prize: 1000, t: (w) => (w.giftsSent || 0) >= 1 },
];
export function checkAch(tx, db, uid, wl) {
  const have = new Set(wl.ach || []);
  const fresh = ACH.filter((a) => !have.has(a.id) && a.t(wl));
  if (!fresh.length) return [];
  for (const a of fresh) { have.add(a.id); credit(tx, db, uid, wl, a.prize, `Başarım: ${a.name}`); }
  wl.ach = [...have];
  tx.set(db.doc(`badges/${uid}`), { ach: wl.ach }, { merge: true });
  return fresh.map((a) => a.id);
}

export function afterGame(tx, db, uid, wl, { won, draw, type, stake, delta, opp, gid, round, points, mars }) {
  wl.games = (wl.games || 0) + 1;
  if (won) wl.wins = (wl.wins || 0) + 1;
  if (won) { wl.tw = { ...(wl.tw || {}) }; wl.tw[type] = (wl.tw[type] || 0) + 1; }
  if (won && mars) wl.marsN = (wl.marsN || 0) + 1;
  wl.xp = (wl.xp || 0) + (won ? XP_WIN : XP_PLAY);
  addStats(tx, db, uid, won ? points || 2 : 0, won);
  const lp = leaguePoints({ won, draw, stake, opp, points });
  addLeague(tx, db, uid, wl, lp, won);
  addTour(tx, db, uid, wl, lp, won);
  addClub(tx, db, wl, lp);
  // galibiyet serisi (sadece jetonlu masalarda; ücretsiz masada bilgisayarı yenip jeton toplanmasın)
  if (won && stake > 0) {
    wl.winStreak = (wl.winStreak || 0) + 1;
    if (wl.winStreak % STREAK_BONUS.every === 0) credit(tx, db, uid, wl, STREAK_BONUS.amount, `Seri bonusu (${wl.winStreak} galibiyet üst üste)`);
  } else if (!draw && !won) wl.winStreak = 0;
  wl.maxStreak = Math.max(wl.maxStreak || 0, wl.winStreak || 0);
  // günlük görevler
  const t = todayTasks(wl);
  t.played++; if (won) t.won++; if (type === "pool") t.pool++; else if (type === "okey") t.okey++;
  wl.td = t;
  // oyun geçmişi
  checkAch(tx, db, uid, wl);
  tx.set(db.doc(`gh/${uid}/g/${gid}_${round}`), { at: Date.now(), type, stake: stake || 0, won: !!won, draw: !!draw, delta: delta || 0, opp: (opp || []).slice(0, 3) });
}
