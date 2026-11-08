// İhaleli Batak (4 kişilik, tekli). Kart: 0..51 → renk = floor(c/13) (0 maça, 1 kupa, 2 karo, 3 sinek), değer: As 14, sonra 2..13
// - Her oyuncuya 13 kart. İhale: dağıtanın solundan başlayarak herkes bir kez, öncekinden yüksek (en az 4) söyler ya da pas der.
//   Herkes pas derse dağıtan 4'e zorunlu kalır. İhaleyi alan kozu seçer ve ilk eli açar.
// - Gelen renge uymak zorunlu; uyarken mümkünse eli geçecek (daha büyük) kart atılır.
// - Renk yoksa koz atmak zorunlu (mümkünse kozla eli geçecek kart). Koz da yoksa herhangi bir kart.
// - Koz kırılmadan koz ile el açılamaz (elde sadece koz kalmadıysa).
// - Puan: ihaleyi alan, söylediği kadar ya da fazla el alırsa aldığı el kadar artı; alamazsa ihale kadar eksi ("batar").
//   Diğerleri aldıkları el kadar artı; hiç el almayan ihale dışı oyuncu da batmış sayılır (eksi 0 değil, 0).
export const suit = (c) => Math.floor(c / 13);
export const val = (c) => (c % 13 === 0 ? 14 : (c % 13) + 1);

export function deal(rnd = Math.random) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((p) => d.slice(p * 13, p * 13 + 13));
}

// Elden atılabilecek kartlar
export function legal(hand, trick, trump, broken) {
  if (!trick.length) {
    if (trump == null || broken) return hand.slice();
    const non = hand.filter((c) => suit(c) !== trump);
    return non.length ? non : hand.slice();
  }
  const lead = suit(trick[0].c);
  const best = winning(trick, trump);
  const bestC = best.c;
  const follow = hand.filter((c) => suit(c) === lead);
  if (follow.length) {
    // koz girmişse (ve gelen renk koz değilse) renk kartı zaten geçemez
    if (suit(bestC) !== lead) return follow;
    const higher = follow.filter((c) => val(c) > val(bestC));
    return higher.length ? higher : follow;
  }
  const trumps = trump == null ? [] : hand.filter((c) => suit(c) === trump);
  if (trumps.length) {
    if (suit(bestC) === trump) { const h = trumps.filter((c) => val(c) > val(bestC)); return h.length ? h : trumps; }
    return trumps;
  }
  return hand.slice();
}

// Elin şu anki galibi
export function winning(trick, trump) {
  const lead = suit(trick[0].c);
  let w = trick[0];
  for (const t of trick.slice(1)) {
    const ws = suit(w.c), ts = suit(t.c);
    if (ts === ws && val(t.c) > val(w.c)) w = t;
    else if (trump != null && ts === trump && ws !== trump) w = t;
    else if (ts === lead && ws !== lead && ws !== trump) w = t;
  }
  return w;
}

export function scores(bidder, bid, tricks) {
  return tricks.map((n, i) => (i === bidder ? (n >= bid ? n : -bid) : n));
}

// ---- bilgisayar ----
export function estimate(hand) {
  let est = 0;
  const bySuit = [0, 1, 2, 3].map((s) => hand.filter((c) => suit(c) === s).map(val).sort((a, b) => b - a));
  for (const vs of bySuit) {
    if (vs[0] === 14) est += 1;
    if (vs.includes(13) && vs.length >= 2) est += vs[0] === 14 ? 1 : 0.6;
    if (vs.includes(12) && vs.length >= 3) est += 0.4;
  }
  const longest = Math.max(...bySuit.map((v) => v.length));
  est += Math.max(0, longest - 4) * 0.9;
  return est;
}
export function bestSuit(hand) {
  let best = 0, bs = -1;
  for (let s = 0; s < 4; s++) {
    const vs = hand.filter((c) => suit(c) === s).map(val);
    const sc = vs.length * 2 + vs.reduce((a, v) => a + (v >= 12 ? 1 : 0), 0);
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}
export function botBid(hand, cur, skill = 1, rnd = Math.random) {
  const e = estimate(hand) + (skill === 0 ? rnd() * 1.5 - 0.5 : 0);
  const want = Math.floor(e);
  return want >= Math.max(4, cur + 1) ? Math.min(13, cur + 1 + (want > cur + 2 && skill > 1 ? 1 : 0)) : 0;
}
export function botCard(hand, trick, trump, broken, skill = 1, rnd = Math.random) {
  const L = legal(hand, trick, trump, broken).sort((a, b) => val(a) - val(b));
  if (skill === 0 && rnd() < 0.3) return L[Math.floor(rnd() * L.length)];
  if (!trick.length) {
    // en güçlü kartla aç (as varsa), yoksa en küçük
    const aces = L.filter((c) => val(c) === 14 && suit(c) !== trump);
    return aces[0] ?? L[0];
  }
  const cur = winning(trick, trump);
  const wins = L.filter((c) => winning([...trick, { c, p: -1 }], trump).p === -1);
  if (wins.length && trick.length === 3) return wins[0];          // son atan: en küçük kazanan
  if (wins.length) return wins[wins.length - 1];                  // öndeyken büyük oyna
  return L[0];                                                    // kaybediyorsa en küçük
}
