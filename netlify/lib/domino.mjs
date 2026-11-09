// Domino (çekmeli, 2 kişilik, 0-6 takımı). Sunucu ve istemci ortak kullanır.
// Taş numarası 0..27 → [a,b] (a<=b)
export const TILES = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]); return t; })();
export const pips = (id) => TILES[id][0] + TILES[id][1];
export const handPips = (h) => h.reduce((s, id) => s + pips(id), 0);

export function deal(rnd = Math.random) {
  const all = TILES.map((_, i) => i);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  return { hands: [all.slice(0, 7), all.slice(7, 14)], bone: all.slice(14) };
}

// Zincirin uçları: chain = [{id, a, b}] (a sol, b sağ yüz)
export function ends(chain) { return chain.length ? [chain[0].a, chain[chain.length - 1].b] : null; }

// Bu taş nereye konabilir: ["L","R"] alt kümesi
export function sides(chain, id) {
  const e = ends(chain); if (!e) return ["R"];
  const [x, y] = TILES[id]; const r = [];
  if (x === e[0] || y === e[0]) r.push("L");
  if (x === e[1] || y === e[1]) r.push("R");
  return r;
}
export const playable = (chain, hand) => hand.filter((id) => sides(chain, id).length);

// Taşı zincire koy (yüzleri uygun çevirir). Döner: yeni zincir
export function place(chain, id, side) {
  const [x, y] = TILES[id];
  if (!chain.length) return [{ id, a: x, b: y }];
  const [l, r] = ends(chain);
  if (side === "L") { const t = y === l ? { id, a: x, b: y } : { id, a: y, b: x }; return [t, ...chain]; }
  const t = x === r ? { id, a: x, b: y } : { id, a: y, b: x };
  return [...chain, t];
}

// Bilgisayar: oynanabilirlerden en çok puanlı (çiftleri önce) taşı seçer; skill 0 rastgele
export function botMove(chain, hand, skill = 1, rnd = Math.random) {
  const ok = playable(chain, hand);
  if (!ok.length) return null;
  if (skill <= 0) { const pick = ok[Math.floor(rnd() * ok.length)]; return { id: pick, side: sides(chain, pick)[0] }; }
  if (skill === 1) {
    const pick = ok.slice().sort((a, b) => (TILES[b][0] === TILES[b][1]) - (TILES[a][0] === TILES[a][1]) || pips(b) - pips(a))[0];
    return { id: pick, side: sides(chain, pick)[0] };
  }
  // usta: her taş ve uç için puan hesaplar — ağır taşı ve çiftleri erken atar, elinde uyan taş bırakan ucu seçer,
  // elinde çok olan sayıyı uçta tutar (rakibi pazara/pasa zorlamak için)
  const cnt = Array(7).fill(0); hand.forEach((id) => { cnt[TILES[id][0]]++; if (TILES[id][1] !== TILES[id][0]) cnt[TILES[id][1]]++; });
  let best = null, bv = -1e9;
  for (const id of ok) for (const side of sides(chain, id)) {
    const nc = place(chain, id, side), e = ends(nc), rest = hand.filter((x) => x !== id);
    let v = pips(id) * 1.2 + (TILES[id][0] === TILES[id][1] ? 4 : 0);
    v += rest.filter((x) => sides(nc, x).length).length * 2.5;
    v += (cnt[e[0]] + cnt[e[1]]) * 1.5;
    if (!rest.length) v += 1000;
    v += rnd() * (skill >= 3 ? 0.1 : 1);
    if (v > bv) { bv = v; best = { id, side }; }
  }
  return best;
}
