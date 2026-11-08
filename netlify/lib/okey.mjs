// Okey motoru — sunucuda çalışır. İstemciler desteyi ve başkalarının elini asla görmez.
//
// Taş kodu: 0..103 gerçek taşlar, 104 ve 105 sahte okey.
//   renk = floor(t / 26)   (0 kırmızı, 1 sarı, 2 mavi, 3 siyah)
//   sayı = floor((t % 26) / 2) + 1   (1..13), her taştan iki tane
// Gösterge (indicator) açılır; okey = göstergenin rengi, sayısı +1 (13'ün okeyi 1).
// Gerçek okey taşları joker (wild) sayılır. Sahte okey, okey taşının yerine geçer (onun değerini taşır).

export const COLORS = ["kırmızı", "sarı", "mavi", "siyah"];
export const FAKE = [104, 105];
export const isFake = (t) => t === 104 || t === 105;
export const colorOf = (t) => Math.floor(t / 26);
export const numOf = (t) => Math.floor((t % 26) / 2) + 1;

export function okeyOf(indicator) {
  const c = colorOf(indicator), n = numOf(indicator);
  return { c, n: n === 13 ? 1 : n + 1 };
}

// Taşın oyundaki değeri: joker ise "W", değilse {c, n}
export function valueOf(t, okey) {
  if (isFake(t)) return { c: okey.c, n: okey.n };
  const c = colorOf(t), n = numOf(t);
  if (c === okey.c && n === okey.n) return "W";
  return { c, n };
}

export function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Yeni el dağıt. dealer 15 taş alır ve ilk atar; diğerleri 14.
export function deal(dealer = 0, players = 4, rnd = Math.random) {
  const all = shuffle([...Array(106).keys()], rnd);
  // Gösterge sahte okey olamaz
  let gi = all.findIndex((t) => !isFake(t));
  const indicator = all.splice(gi, 1)[0];
  const hands = [];
  for (let p = 0; p < players; p++) hands.push(all.splice(0, p === dealer ? 15 : 14));
  return { indicator, okey: okeyOf(indicator), hands, pile: all };
}

/* ---------------- el kontrolü ---------------- */

function toCounts(tiles, okey) {
  const cnt = [0, 1, 2, 3].map(() => new Array(15).fill(0));
  let w = 0;
  for (const t of tiles) {
    const v = valueOf(t, okey);
    if (v === "W") w++;
    else cnt[v.c][v.n]++;
  }
  return { cnt, w };
}

// Bütün taşlar per (aynı sayı farklı renk, 3-4) veya seri (aynı renk ardışık, en az 3; 12-13-1 geçerli) olarak bölünebilir mi?
function canGroup(cnt, w, groups) {
  let c = -1, n = -1;
  outer: for (let ci = 0; ci < 4; ci++) for (let ni = 1; ni <= 13; ni++) if (cnt[ci][ni] > 0) { c = ci; n = ni; break outer; }
  if (c < 0) return w === 0 || groups > 0; // artan joker var olan bir gruba eklenebilir
  cnt[c][n]--;

  // 1) Per: aynı sayı, farklı renkler
  const others = [0, 1, 2, 3].filter((x) => x !== c && cnt[x][n] > 0);
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const pick = others.filter((_, i) => mask & (1 << i));
    for (const size of [3, 4]) {
      const need = size - 1 - pick.length;
      if (need < 0 || need > w) continue;
      if (pick.length + 1 + need > 4) continue;
      pick.forEach((x) => cnt[x][n]--);
      const ok = canGroup(cnt, w - need, groups + 1);
      pick.forEach((x) => cnt[x][n]++);
      if (ok) { cnt[c][n]++; return true; }
    }
  }

  // 2) Seri: aynı renk; n'den önce joker olabilir, 14. pozisyon = 1 (12-13-1)
  for (let s = Math.max(1, n - w); s <= n; s++) {
    let jUsed = n - s; // n'den önceki pozisyonlar joker
    const used = [];
    if (n - s + 1 >= 3 && canGroup(cnt, w - jUsed, groups + 1)) { cnt[c][n]++; return true; }
    for (let p = n + 1; p <= 14; p++) {
      const num = p === 14 ? 1 : p;
      if (p === 14 && n === 1) break;
      if (cnt[c][num] > 0) { cnt[c][num]--; used.push(num); }
      else { if (jUsed + 1 > w) break; jUsed++; used.push(null); }
      const len = p - s + 1;
      if (len >= 3 && canGroup(cnt, w - jUsed, groups + 1)) {
        used.forEach((u) => { if (u !== null) cnt[c][u]++; });
        cnt[c][n]++;
        return true;
      }
    }
    used.forEach((u) => { if (u !== null) cnt[c][u]++; });
  }

  // 3) n = 1 ise 1, sonu 13'ten sonra gelen bir serinin son taşı olabilir (… 12-13-1)
  if (n === 1) {
    for (let s = 12; s >= 2; s--) {
      let jUsed = 0;
      const used = [];
      let ok = true;
      for (let p = s; p <= 13; p++) {
        if (cnt[c][p] > 0) { cnt[c][p]--; used.push(p); }
        else if (jUsed < w) { jUsed++; used.push(null); }
        else { ok = false; break; }
      }
      if (ok && canGroup(cnt, w - jUsed, groups + 1)) {
        used.forEach((u) => { if (u !== null) cnt[c][u]++; });
        cnt[c][n]++;
        return true;
      }
      used.forEach((u) => { if (u !== null) cnt[c][u]++; });
    }
  }

  cnt[c][n]++;
  return false;
}

function isPairs(tiles, okey) {
  const { cnt, w } = toCounts(tiles, okey);
  let pairs = 0, singles = 0;
  for (let c = 0; c < 4; c++) for (let n = 1; n <= 13; n++) {
    pairs += Math.floor(cnt[c][n] / 2);
    singles += cnt[c][n] % 2;
  }
  if (w < singles || (w - singles) % 2) return false;
  return pairs + singles + (w - singles) / 2 === 7;
}

// 14 taş el bitiyor mu? Sonuç: false | "seri" | "cift"
export function winKind(tiles, okey) {
  if (tiles.length !== 14) return false;
  const { cnt, w } = toCounts(tiles, okey);
  if (canGroup(cnt, w, 0)) return "seri";
  if (isPairs(tiles, okey)) return "cift";
  return false;
}

// 15 taşlık elden hangi taşı atınca bitiyor? (bulamazsa null)
export function findFinish(hand15, okey) {
  const tried = new Set();
  // Önce jokeri atarak bitmeyi dene (okey atarak bitmek çift puan)
  const order = [...hand15].sort((a, b) => (valueOf(b, okey) === "W") - (valueOf(a, okey) === "W"));
  for (const t of order) {
    const key = JSON.stringify(valueOf(t, okey));
    if (tried.has(key)) continue;
    tried.add(key);
    const rest = hand15.filter((x, i) => i !== hand15.indexOf(t));
    const k = winKind(rest, okey);
    if (k) return { tile: t, kind: k };
  }
  return null;
}

/* ---------------- bilgisayar oyuncu ---------------- */

function usefulness(t, hand, okey) {
  const v = valueOf(t, okey);
  if (v === "W") return 1000;
  let s = 0;
  const seenColors = new Set();
  for (const o of hand) {
    if (o === t) continue;
    const u = valueOf(o, okey);
    if (u === "W") continue;
    if (u.c === v.c) {
      const d = Math.abs(u.n - v.n);
      const dw = Math.min(d, 13 - d); // 13-1 komşuluğu
      if (d === 0) s += 2; // aynı taş: çift ihtimali
      else if (dw === 1) s += 4;
      else if (dw === 2) s += 2;
    } else if (u.n === v.n && !seenColors.has(u.c)) {
      seenColors.add(u.c);
      s += 4;
    }
  }
  return s;
}

// skill: 0 kolay, 1 orta, 2 zor
export function botChooseDraw(hand, leftTop, okey, skill = 2) {
  if (leftTop == null) return "pile";
  if (findFinish([...hand, leftTop], okey)) return "left";
  if (valueOf(leftTop, okey) === "W") return "left";
  if (skill === 0) return Math.random() < 0.25 ? "left" : "pile";
  return usefulness(leftTop, [...hand, leftTop], okey) >= (skill === 1 ? 8 : 6) ? "left" : "pile";
}

export function botChooseDiscard(hand15, okey, rnd = Math.random, skill = 2) {
  const noise = skill === 0 ? 7 : skill === 1 ? 2.5 : 0.5;
  let best = null, bestScore = Infinity;
  for (const t of hand15) {
    if (skill === 0 && valueOf(t, okey) === "W") continue;
    const sc = usefulness(t, hand15, okey) + rnd() * noise;
    if (sc < bestScore) { bestScore = sc; best = t; }
  }
  return best;
}

export function tileLabel(t) {
  if (isFake(t)) return "sahte okey";
  return `${COLORS[colorOf(t)]} ${numOf(t)}`;
}

/* ---------------- ıstaka dizme (istemci kullanır) ---------------- */

// Taşları perlere (aynı sayı farklı renk 3-4), serilere (aynı renk ardışık ≥3, 12-13-1 dahil) ayırır.
// Mümkün olduğunca çok taşı gruba koyar; okeyler boşlukları doldurur. Dönüş: { groups: [[taş…]…], rest: [taş…] }
export function arrange(tiles, okey) {
  const wilds = tiles.filter((t) => valueOf(t, okey) === "W");
  const norm = tiles.filter((t) => valueOf(t, okey) !== "W").map((t) => ({ t, ...valueOf(t, okey) }));
  norm.sort((a, b) => a.c - b.c || a.n - b.n || a.t - b.t);
  let best = { score: -1, groups: [], rest: tiles.slice() };
  let steps = 0;
  const take = (pool, c, n) => { const i = pool.findIndex((x) => x.c === c && x.n === n); return i < 0 ? null : pool.splice(i, 1)[0]; };

  function rec(pool, w, groups, rest, placed) {
    if (++steps > 60000) return;
    // üst sınır: kalan taşların hepsi yerleşse bile en iyiyi geçemiyorsa dur
    if (placed + pool.length + w <= best.score) return;
    if (!pool.length) {
      // artan okeyler: varsa bir grubun ucuna ekle (seri 13'ü geçmesin diye basitçe sona)
      const g2 = groups.map((g) => g.slice()), left = w;
      const score = placed + (g2.length ? left : 0);
      if (score > best.score || (score === best.score && g2.length < best.groups.length)) {
        let wl = wilds.slice(wilds.length - w);
        if (g2.length) { for (const x of wl) g2[g2.length - 1].push(x); wl = []; }
        best = { score, groups: g2, rest: [...rest, ...wl] };
      }
      return;
    }
    const first = pool[0];
    const others = pool.slice(1);
    const useW = (k) => wilds.slice(wilds.length - w, wilds.length - w + k);

    // 1) seri: first'ten başlayıp yukarı (13'ten sonra 1)
    {
      const p = others.slice(); const run = [first.t]; let jw = 0; const jt = [];
      for (let n = first.n + 1; n <= 14; n++) {
        const num = n === 14 ? 1 : n;
        if (n === 14 && first.n === 1) break;
        const got = take(p, first.c, num);
        if (got) run.push(got.t);
        else { if (jw >= w) break; run.push(null); jw++; }
        if (run.length >= 3 && run[run.length - 1] !== null) {
          const wl = useW(jw); let k = 0;
          rec(p.slice(), w - jw, [...groups, run.map((x) => (x === null ? wl[k++] : x))], rest, placed + run.length);
        }
      }
    }
    // 1b) first = 1 ise ...12-13-1 serisinin sonu olabilir
    if (first.n === 1) {
      for (let s = 12; s >= 2; s--) {
        const p = others.slice(); const run = []; let jw = 0; let ok = true;
        for (let n = s; n <= 13; n++) { const got = take(p, first.c, n); if (got) run.push(got.t); else if (jw < w) { run.push(null); jw++; } else { ok = false; break; } }
        if (!ok || run.every((x) => x === null) && jw > 1) continue;
        run.push(first.t);
        const wl = useW(jw); let k = 0;
        rec(p, w - jw, [...groups, run.map((x) => (x === null ? wl[k++] : x))], rest, placed + run.length);
      }
    }
    // 2) per: aynı sayı farklı renkler (+okey)
    {
      const cols = [0, 1, 2, 3].filter((c) => c !== first.c && others.some((x) => x.c === c && x.n === first.n));
      for (let mask = (1 << cols.length) - 1; mask >= 0; mask--) {
        const pick = cols.filter((_, i) => mask & (1 << i));
        for (const size of [4, 3]) {
          const need = size - 1 - pick.length;
          if (need < 0 || need > w) continue;
          const p = others.slice(); const g = [first.t];
          for (const c of pick) g.push(take(p, c, first.n).t);
          g.push(...useW(need));
          rec(p, w - need, [...groups, g], rest, placed + size);
        }
      }
    }
    // 3) tek kalsın
    rec(others, w, groups, [...rest, first.t], placed);
  }
  rec(norm, wilds.length, [], [], 0);
  return { groups: best.groups, rest: best.rest };
}

// Istakada yan yana duran taşlar geçerli bir grup (ya da gruplar) mı?
export function validRun(tiles, okey) {
  if (tiles.length < 3) return false;
  const { cnt, w } = toCounts(tiles, okey);
  if (w === tiles.length) return true;
  return canGroup(cnt, w, 0);
}
