// Tavla kuralları (sunucu ve istemci ortak kullanır).
// Tahta: 24 hane, board[i] > 0 → 0. oyuncunun pulları, < 0 → 1. oyuncunun pulları.
// 0. oyuncu 23'ten 0'a doğru ilerler (evi 0–5), 1. oyuncu 0'dan 23'e (evi 18–23).
// Hamle {from, to}: from = 24 kırık pul (bar), to = -1 pul toplama. Koordinatlar oyuncuya göre "göreli"dir
// (her oyuncu kendini 0. oyuncu gibi görür); abs() ile mutlak haneye çevrilir.
export const START = (() => { const b = Array(24).fill(0); b[23] = 2; b[12] = 5; b[7] = 3; b[5] = 5; b[0] = -2; b[11] = -5; b[16] = -3; b[18] = -5; return b; })();

export function newGame() { return { board: START.slice(), bar: [0, 0], off: [0, 0] }; }

// Oyuncunun gözünden tahta: kendi pulları pozitif, 23→0 yönünde
export function rel(s, p) {
  const b = p === 0 ? s.board.slice() : s.board.slice().reverse().map((x) => -x);
  return { b, bar: s.bar[p], obar: s.bar[1 - p], off: s.off[p] };
}
export const absPt = (p, i) => (i < 0 || i > 23 ? i : p === 0 ? i : 23 - i);

const allHome = (r) => r.bar === 0 && r.b.every((x, i) => i < 6 || x <= 0);

// Tek bir zarla yapılabilecek hamleler
export function singleMoves(r, d) {
  const out = [];
  if (r.bar > 0) { const to = 24 - d; if (r.b[to] >= -1) out.push({ from: 24, to }); return out; }
  const home = allHome(r);
  for (let i = 23; i >= 0; i--) {
    if (r.b[i] <= 0) continue;
    const to = i - d;
    if (to >= 0) { if (r.b[to] >= -1) out.push({ from: i, to }); }
    else if (home) {
      // tam zarla ya da daha yüksekte pul yoksa büyük zarla topla
      if (to === -1) out.push({ from: i, to: -1 });
      else { let higher = false; for (let k = i + 1; k < 6; k++) if (r.b[k] > 0) { higher = true; break; } if (!higher) out.push({ from: i, to: -1 }); }
    }
  }
  return out;
}

export function applyRel(r, m) {
  const n = { b: r.b.slice(), bar: r.bar, obar: r.obar, off: r.off };
  if (m.from === 24) n.bar--; else n.b[m.from]--;
  if (m.to === -1) n.off++;
  else { if (n.b[m.to] === -1) { n.b[m.to] = 0; n.obar++; } n.b[m.to]++; }
  return n;
}

// Bütün yasal hamle dizileri (zarların en çoğunu kullanan; tek zar kullanılabiliyorsa büyük olan)
export function sequences(r, dice) {
  const ds = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : [dice[0], dice[1]];
  const res = [];
  const seen = new Set();
  const rec = (st, left, path) => {
    let moved = false;
    const tried = new Set();
    for (let k = 0; k < left.length; k++) {
      const d = left[k];
      if (tried.has(d)) continue; tried.add(d);
      for (const m of singleMoves(st, d)) {
        moved = true;
        rec(applyRel(st, m), left.filter((_, j) => j !== k), [...path, { ...m, d }]);
      }
    }
    if (!moved) { const key = path.map((m) => m.from + ">" + m.to).join(","); if (!seen.has(key)) { seen.add(key); res.push(path); } }
  };
  rec(r, ds, []);
  const max = Math.max(0, ...res.map((x) => x.length));
  let best = res.filter((x) => x.length === max);
  if (max === 1 && ds.length === 2 && ds[0] !== ds[1]) {
    const big = Math.max(...ds);
    if (best.some((x) => x[0].d === big)) best = best.filter((x) => x[0].d === big);
  }
  return max === 0 ? [[]] : best;
}

// Mutlak duruma göreli hamle dizisi uygula
export function applySeq(s, p, seq) {
  let r = rel(s, p);
  for (const m of seq) r = applyRel(r, m);
  const b = p === 0 ? r.b : r.b.slice().reverse().map((x) => -x);
  const bar = [0, 0], off = [0, 0];
  bar[p] = r.bar; bar[1 - p] = r.obar; off[p] = r.off; off[1 - p] = s.off[1 - p];
  return { board: b, bar, off };
}

// Gönderilen dizi yasal mı? (sıra önemli; zarlar sunucunun attığı zarlar)
export function isLegal(s, p, dice, seq) {
  const all = sequences(rel(s, p), dice);
  const key = (x) => x.map((m) => m.from + ">" + m.to).join(",");
  const k = key(seq);
  return all.some((x) => key(x) === k);
}

export const pips = (s, p) => { const r = rel(s, p); return r.b.reduce((a, x, i) => a + (x > 0 ? x * (i + 1) : 0), 0) + r.bar * 25; };

// Oyun bitti mi; mars (rakip hiç pul toplamadıysa) 2 sayı
export function result(s) {
  for (const p of [0, 1]) if (s.off[p] === 15) return { winner: p, mars: s.off[1 - p] === 0 };
  return null;
}

// Bilgisayar: bütün dizileri dene, sonucu puanla
export function botSeq(s, p, dice, skill = 1, rnd = Math.random) {
  const all = sequences(rel(s, p), dice);
  if (all.length === 1) return all[0];
  if (skill === 0 && rnd() < 0.2) return all[Math.floor(rnd() * all.length)];
  let best = all[0], bv = -Infinity;
  for (const seq of all) {
    let r = rel(s, p);
    for (const m of seq) r = applyRel(r, m);
    const v = evalRel(r, skill) + rnd() * (skill > 1 ? 0.5 : 3);
    if (v > bv) { bv = v; best = seq; }
  }
  return best;
}

function evalRel(r, skill) {
  let v = 0;
  const pip = r.b.reduce((a, x, i) => a + (x > 0 ? x * (i + 1) : 0), 0) + r.bar * 25;
  const opip = r.b.reduce((a, x, i) => a + (x < 0 ? -x * (24 - i) : 0), 0) + r.obar * 25;
  v += (opip - pip) * 0.6;
  v += r.off * 6 + r.obar * 9;
  // en uzak rakip pulu: ondan geride kalan açık pullar tehlikeli değil
  let far = -1; for (let i = 0; i < 24; i++) if (r.b[i] < 0) far = Math.max(far, i);
  if (r.obar > 0) far = 24;
  for (let i = 0; i < 24; i++) {
    if (r.b[i] >= 2) v += i < 6 ? 4 : i < 12 ? 2.5 : 1;
    if (r.b[i] === 1 && i < far) v -= skill > 0 ? (i < 6 ? 6 : 4) + (r.obar ? 1 : 0) : 2;
  }
  // ev tahtasında art arda kapılar (prime)
  if (skill > 1) { let run = 0, best = 0; for (let i = 0; i < 12; i++) { run = r.b[i] >= 2 ? run + 1 : 0; best = Math.max(best, run); } v += best * best; }
  return v;
}

export const roll = (rnd = Math.random) => [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
