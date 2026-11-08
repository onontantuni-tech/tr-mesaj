// Kızma Birader (4 kişilik). Her oyuncunun 4 piyonu var. Göreli konum: -1 ev, 0..39 yol (0 = başlangıç karesi), 40..43 bitiş.
// - Evden çıkmak için 6 gerekir. 6 atan bir kez daha atar.
// - Yolda rakibin piyonunun üstüne gelen onu eve yollar. Kendi piyonunun üstüne gelinmez.
// - Bitişe tam sayıyla girilir (43'ü geçemez). Dört piyonu bitişe sokan kazanır.
export const START = [0, 10, 20, 30];
export const abs = (p, rel) => (START[p] + rel) % 40;
export function newGame() { return { pos: { 0: [-1, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [-1, -1, -1, -1], 3: [-1, -1, -1, -1] } }; }
export const P = (s, p) => s.pos[p] || s.pos[String(p)];
export function moves(s, p, d) {
  const mine = P(s, p), out = [];
  for (let k = 0; k < 4; k++) {
    const r = mine[k];
    let to;
    if (r === -1) { if (d !== 6) continue; to = 0; }
    else { to = r + d; if (to > 43) continue; }
    if (mine.some((x, j) => j !== k && x === to)) continue;
    out.push({ k, to });
  }
  return out;
}
export function apply(s, p, m) {
  const mine = P(s, p).slice(); mine[m.k] = m.to;
  const pos = { ...s.pos, [p]: mine };
  let hit = null;
  if (m.to < 40) {
    const a = abs(p, m.to);
    for (let q = 0; q < 4; q++) {
      if (q === p) continue;
      const theirs = P({ pos }, q).slice();
      for (let j = 0; j < 4; j++) if (theirs[j] >= 0 && theirs[j] < 40 && abs(q, theirs[j]) === a) { theirs[j] = -1; hit = q; }
      pos[q] = theirs;
    }
  }
  return { s: { pos }, hit };
}
export const won = (s, p) => P(s, p).every((x) => x >= 40);
export function botMove(s, p, d, skill = 1, rnd = Math.random) {
  const ms = moves(s, p, d);
  if (!ms.length) return null;
  if (skill === 0 && rnd() < 0.4) return ms[Math.floor(rnd() * ms.length)];
  let best = ms[0], bv = -1e9;
  for (const m of ms) {
    const r = apply(s, p, m);
    let v = 0;
    if (r.hit != null) v += 50;
    if (P(s, p)[m.k] === -1) v += 30;
    if (m.to >= 40) v += 40;
    v += m.to;
    // tehlike: arkamızdaki 1-6 kare içinde rakip var mı
    if (m.to < 40 && skill > 0) {
      const a = abs(p, m.to);
      for (let q = 0; q < 4; q++) if (q !== p) for (const x of P(r.s, q)) if (x >= 0 && x < 40) { const dist = (a - abs(q, x) + 40) % 40; if (dist >= 1 && dist <= 6) v -= 25; }
    }
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}
export const roll = (rnd = Math.random) => 1 + Math.floor(rnd() * 6);
