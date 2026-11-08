// Pişti kuralları (2 kişilik). Kart: 0..51 → renk = floor(c/13) (0 maça, 1 kupa, 2 karo, 3 sinek), değer = c%13+1 (1 As, 11 Vale, 12 Kız, 13 Papaz)
// - Yere 4 kart açılır (3'ü kapalı, en üstteki açık). Herkese 4'er kart dağıtılır, eller bitince deste bitene kadar yeniden 4'er.
// - Atılan kart yerdeki en üst kartla aynı değerdeyse ya da Vale ise yerdeki tüm kartlar alınır.
// - Yerde tek kart varken aynı değerle almak "pişti"dir: 10 puan; Vale ile Vale'ye pişti 20 puan.
// - El sonunda yerde kalan kartlar son alan oyuncuya gider.
// - Puanlar: her As 1, her Vale 1, sinek 2'li 2, karo 10'lu 3, en çok kart alan 3 puan (eşitse kimse almaz).
export const rank = (c) => (c % 13) + 1;
export const suit = (c) => Math.floor(c / 13);
export const JACK = 11;
export const CLUB2 = 3 * 13 + 1, DIAMOND10 = 2 * 13 + 9;

export function shuffle(rnd = Math.random) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

export function cardPoints(c) {
  let p = 0;
  if (rank(c) === 1) p += 1;
  if (rank(c) === JACK) p += 1;
  if (c === CLUB2) p += 2;
  if (c === DIAMOND10) p += 3;
  return p;
}

// Yeni el: deste, yer, eller
export function deal(rnd = Math.random) {
  const deck = shuffle(rnd);
  let pile = deck.splice(0, 4);
  // En üstte Vale açılırsa desteye geri koyup yenisini aç (yaygın kural)
  let guard = 0;
  while (rank(pile[3]) === JACK && guard++ < 20) { deck.push(pile.pop()); pile.push(deck.shift()); }
  const hands = [deck.splice(0, 4), deck.splice(0, 4)];
  return { deck, pile, hands, taken: [[], []], pisti: [0, 0], lastTaker: null, hidden: 3 };
}

// Kart oyna. s: {deck, pile, hands, taken, pisti, lastTaker}. Dönüş: {captured, pisti, value}
export function play(s, seat, card) {
  const h = s.hands[seat];
  const i = h.indexOf(card);
  if (i < 0) throw new Error("card");
  h.splice(i, 1);
  const top = s.pile[s.pile.length - 1];
  let captured = false, pisti = 0;
  if (s.pile.length && (rank(card) === rank(top) || rank(card) === JACK)) {
    if (s.pile.length === 1 && rank(card) === rank(top)) pisti = rank(card) === JACK ? 20 : 10;
    s.taken[seat].push(...s.pile, card);
    s.pile = [];
    s.lastTaker = seat;
    s.hidden = 0;
    s.pisti[seat] += pisti;
    captured = true;
  } else s.pile.push(card);
  // eller bittiyse yeniden dağıt
  if (s.hands.every((x) => !x.length) && s.deck.length) s.hands = [s.deck.splice(0, 4), s.deck.splice(0, 4)];
  return { captured, pisti };
}

export const handOver = (s) => s.hands.every((x) => !x.length) && !s.deck.length;

// El sonu: kalan kartlar son alana, puanlar
export function finish(s) {
  if (s.pile.length && s.lastTaker != null) { s.taken[s.lastTaker].push(...s.pile); s.pile = []; }
  const pts = [0, 1].map((i) => s.taken[i].reduce((a, c) => a + cardPoints(c), 0) + s.pisti[i]);
  const n0 = s.taken[0].length, n1 = s.taken[1].length;
  if (n0 > n1) pts[0] += 3; else if (n1 > n0) pts[1] += 3;
  return pts;
}

// Bilgisayar hamlesi. skill 0..2
export function botCard(s, seat, skill = 1, rnd = Math.random) {
  const h = s.hands[seat];
  const top = s.pile[s.pile.length - 1];
  const pileVal = s.pile.reduce((a, c) => a + cardPoints(c), 0) + s.pile.length * 0.15;
  const match = h.filter((c) => top != null && rank(c) === rank(top));
  const jacks = h.filter((c) => rank(c) === JACK);
  if (match.length && (skill > 0 || rnd() < 0.8)) return match[0];
  if (jacks.length && s.pile.length && (pileVal >= 1.5 || s.pile.length >= 4) && (skill > 0 || rnd() < 0.5)) return jacks[0];
  const nonJ = h.filter((c) => rank(c) !== JACK);
  const pool = nonJ.length ? nonJ : h;
  if (skill === 0) return pool[Math.floor(rnd() * pool.length)];
  // en az değerli; yer boşken iyi oyuncu yerde görülen değerleri tercih eder (rakibin pişti yapma ihtimali düşük)
  const seen = (r) => s.taken.flat().filter((c) => rank(c) === r).length;
  return [...pool].sort((a, b) => (cardPoints(a) - cardPoints(b)) || (skill > 1 && !s.pile.length ? seen(rank(b)) - seen(rank(a)) : 0))[0];
}
