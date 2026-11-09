// 8 top bilardo: fizik, kurallar ve bilgisayar oyuncu.
// Hem sunucu hem istemci aynı kodu kullanır. Fizik sadece + - * / ve Math.sqrt kullanır,
// bu yüzden aynı başlangıçtan her cihazda birebir aynı sonuç çıkar (tekrar animasyonu için).

export const W = 1000, H = 500, R = 14;
export const MAXV = 55;            // en sert vuruşta beyaz topun adım başına hızı
const SUB = 6;                     // her adımda alt adım
const FRICTION = 0.993, ROLL = 0.01, STOP = 0.05;
const E_BALL = 0.96, E_WALL = 0.85;
export const POCKETS = [[0, 0, 36], [W / 2, -8, 28], [W, 0, 36], [0, H, 36], [W / 2, H + 8, 28], [W, H, 36]];
const MOUTH_C = 36, MOUTH_M = 26;
export const HEAD_X = 250;         // açış çizgisi (beyaz top bu çizginin solunda yerleştirilir)
export const FOOT = [750, 250];

export const typeOf = (i) => (i === 0 ? "cue" : i === 8 ? "eight" : i < 8 ? "solid" : "stripe");

// Başlangıç dizilişi. rnd: 0..1 arası sayı veren fonksiyon
export function rack(rnd = Math.random) {
  const others = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
  // arka köşelere bir düz bir çizgili
  const s = others.findIndex((x) => x < 8), t = others.findIndex((x) => x > 8);
  const a = others[s], b = others[t];
  const rest = others.filter((x) => x !== a && x !== b);
  const dx = Math.sqrt(3) * R + 0.2, dy = 2 * R + 0.2;
  const balls = [{ i: 0, x: 250, y: 250 }];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const x = FOOT[0] + row * dx, y = FOOT[1] + (j - row / 2) * dy;
      let id;
      if (row === 2 && j === 1) id = 8;
      else if (row === 4 && j === 0) id = a;
      else if (row === 4 && j === 4) id = b;
      else id = rest[k++];
      balls.push({ i: id, x, y });
    }
  }
  return balls;
}

const cloneBalls = (balls) => balls.map((b) => ({ i: b.i, x: b.x, y: b.y }));

// Vuruşu simüle et. balls: masadaki toplar [{i,x,y}], açı (radyan), güç 0..1.
// onFrame(balls) verilirse her adımda çağrılır (animasyon için).
// spin: {x: yan falso -1..1, y: üst(+)/alt(-) falso -1..1}
export function simulate(balls0, angle, power, onFrame, spin) {
  const bs = cloneBalls(balls0).map((b) => ({ ...b, vx: 0, vy: 0, on: true }));
  const cue = bs.find((b) => b.i === 0);
  const v = Math.max(0.02, Math.min(1, power)) * MAXV;
  // açı → yön (cos/sin yerine birim vektör veriyoruz ki her cihazda aynı olsun)
  const dir = typeof angle === "object" ? angle : { x: Math.cos(angle), y: Math.sin(angle) };
  const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
  cue.vx = (dir.x / dl) * v; cue.vy = (dir.y / dl) * v;
  const clamp = (a) => (isFinite(a) ? Math.max(-1, Math.min(1, a)) : 0);
  let spx = clamp(spin && spin.x), spy = clamp(spin && spin.y);
  const ux = dir.x / dl, uy = dir.y / dl;
  const res = { firstHit: null, pocketed: [], cushionAfter: false, steps: 0 };
  const n = bs.length;
  for (let step = 0; step < 3000; step++) {
    let moving = false;
    for (let s = 0; s < SUB; s++) {
      for (const b of bs) if (b.on) { b.x += b.vx / SUB; b.y += b.vy / SUB; }
      // top-top çarpışması
      for (let i = 0; i < n; i++) {
        const p = bs[i]; if (!p.on) continue;
        for (let j = i + 1; j < n; j++) {
          const q = bs[j]; if (!q.on) continue;
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const ov = (2 * R - d) / 2;
          p.x -= nx * ov; p.y -= ny * ov; q.x += nx * ov; q.y += ny * ov;
          const vn = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
          if (vn > 0) {
            const cueIn = p.i === 0 ? p : q.i === 0 ? q : null;
            const sp0 = cueIn ? Math.sqrt(cueIn.vx * cueIn.vx + cueIn.vy * cueIn.vy) : 0;
            const k = ((1 + E_BALL) / 2) * vn;
            p.vx -= k * nx; p.vy -= k * ny; q.vx += k * nx; q.vy += k * ny;
            // üst/alt falso: ilk temasta beyaz top ileri gider (takip) ya da geri döner (çekme)
            if (cueIn && spy && res.firstHit === null) { cueIn.vx += ux * spy * 0.55 * sp0; cueIn.vy += uy * spy * 0.55 * sp0; spy = 0; }
            if (res.firstHit === null && (p.i === 0 || q.i === 0)) res.firstHit = p.i === 0 ? q.i : p.i;
          }
        }
      }
      // bantlar ve ceplere giriş
      for (const b of bs) {
        if (!b.on) continue;
        const inMouthX = b.y < MOUTH_C || b.y > H - MOUTH_C;
        const inMouthY = b.x < MOUTH_C || b.x > W - MOUTH_C || (b.x > W / 2 - MOUTH_M && b.x < W / 2 + MOUTH_M);
        if (!inMouthX) {
          if (b.x < R) { b.x = R; if (b.vx < 0) { b.vx = -b.vx * E_WALL; b.vy *= 0.97; b._bounced = true; if (res.firstHit !== null) res.cushionAfter = true; } }
          else if (b.x > W - R) { b.x = W - R; if (b.vx > 0) { b.vx = -b.vx * E_WALL; b.vy *= 0.97; b._bounced = true; if (res.firstHit !== null) res.cushionAfter = true; } }
        }
        if (!inMouthY) {
          if (b.y < R) { b.y = R; if (b.vy < 0) { b.vy = -b.vy * E_WALL; b.vx *= 0.97; b._bounced = true; if (res.firstHit !== null) res.cushionAfter = true; } }
          else if (b.y > H - R) { b.y = H - R; if (b.vy > 0) { b.vy = -b.vy * E_WALL; b.vx *= 0.97; b._bounced = true; if (res.firstHit !== null) res.cushionAfter = true; } }
        }
        if (b.i === 0 && spx && b._bounced) {
          // yan falso: bantta beyaz topun açısı değişir, her bantta yarıya iner
          const a = spx * 0.35, c = Math.cos(a), sn = Math.sin(a);
          const vx = b.vx * c - b.vy * sn, vy = b.vx * sn + b.vy * c; b.vx = vx; b.vy = vy; spx *= 0.5; if (Math.abs(spx) < 0.05) spx = 0;
        }
        b._bounced = false;
        let inPocket = false;
        for (const [px, py, pr] of POCKETS) { const dx = b.x - px, dy = b.y - py; if (dx * dx + dy * dy < pr * pr) { inPocket = true; break; } }
        if (!inPocket && (b.x < -2 * R || b.x > W + 2 * R || b.y < -2 * R || b.y > H + 2 * R)) inPocket = true;
        if (inPocket) { b.on = false; b.vx = 0; b.vy = 0; res.pocketed.push(b.i); }
      }
    }
    for (const b of bs) {
      if (!b.on) continue;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp === 0) continue;
      const ns = sp * FRICTION - ROLL;
      if (ns <= STOP) { b.vx = 0; b.vy = 0; }
      else { b.vx = (b.vx / sp) * ns; b.vy = (b.vy / sp) * ns; moving = true; }
    }
    res.steps = step + 1;
    if (onFrame) onFrame(bs.filter((b) => b.on).map((b) => ({ i: b.i, x: b.x, y: b.y })), res.pocketed);
    if (!moving) break;
  }
  res.balls = bs.filter((b) => b.on).map((b) => ({ i: b.i, x: b.x, y: b.y }));
  return res;
}

// Beyaz top buraya konabilir mi?
export function canPlace(balls, x, y, kitchen) {
  if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
  if (kitchen && x > HEAD_X) return false;
  for (const b of balls) { if (b.i === 0) continue; const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy < 4 * R * R + 0.5) return false; }
  return true;
}

// 8 topu yeniden yerleştir (açışta girerse)
export function spotBall(balls, id) {
  const cueHit = (x, y) => balls.some((b) => b.i === 0 && (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < 4 * R * R + 0.5);
  for (let k = 0; k < 40; k++) {
    const x = FOOT[0] + k * (2 * R + 1), y = FOOT[1];
    if (x > W - R) break;
    if (canPlace(balls, x, y, false) && !cueHit(x, y)) { balls.push({ i: id, x, y }); return; }
  }
  for (let k = 1; k < 40; k++) {
    const x = FOOT[0] - k * (2 * R + 1), y = FOOT[1];
    if (canPlace(balls, x, y, false) && !cueHit(x, y)) { balls.push({ i: id, x, y }); return; }
  }
}

const remaining = (balls, group) => balls.filter((b) => typeOf(b.i) === group).length;

// Vuruşun kurallarını uygula. st: {balls, groups:[g0,g1]|null, turn, ballInHand, broken}
// Döner: {foul, reason, winner (seat|null), cont}
export function applyShot(st, seat, res, before) {
  const other = 1 - seat;
  const isBreak = !st.broken;
  const mine = st.groups ? st.groups[seat] : null;
  const myLeftBefore = mine ? remaining(before, mine) : 7;
  let foul = false, reason = "";
  if (res.pocketed.includes(0)) { foul = true; reason = "Beyaz top cebe girdi"; }
  else if (res.firstHit === null) { foul = true; reason = "Hiçbir topa değmedi"; }
  else if (mine) {
    const legal = myLeftBefore === 0 ? 8 : null;
    if (legal === 8 ? res.firstHit !== 8 : typeOf(res.firstHit) !== mine) { foul = true; reason = "Önce kendi grubuna vurmalısın"; }
  } else if (!isBreak && res.firstHit === 8) { foul = true; reason = "Önce siyah 8'e vurulamaz"; }
  if (!foul && !isBreak && !res.pocketed.length && !res.cushionAfter) { foul = true; reason = "Hiçbir top banda ya da cebe gitmedi"; }

  let balls = res.balls.slice();
  st.broken = true;
  // 8 top
  if (res.pocketed.includes(8)) {
    if (isBreak) { spotBall(balls, 8); }
    else {
      st.balls = balls.filter((b) => b.i !== 0).concat(res.pocketed.includes(0) ? [] : balls.filter((b) => b.i === 0));
      const win = !foul && mine && myLeftBefore === 0;
      return { foul, reason: win ? "Siyah 8'i soktu" : (mine && myLeftBefore > 0 ? "Siyah 8 erken girdi" : foul ? "Siyah 8 faulle girdi" : "Siyah 8 erken girdi"), winner: win ? seat : other, cont: false };
    }
  }
  const objs = res.pocketed.filter((i) => i !== 0 && i !== 8);
  if (!st.groups && !foul && !isBreak && objs.length) {
    const g = typeOf(objs[0]);
    st.groups = seat === 0 ? [g, g === "solid" ? "stripe" : "solid"] : [g === "solid" ? "stripe" : "solid", g];
  }
  const myG = st.groups ? st.groups[seat] : null;
  const cont = !foul && (isBreak ? objs.length > 0 : myG ? objs.some((i) => typeOf(i) === myG) : objs.length > 0);
  if (res.pocketed.includes(0)) balls = balls.filter((b) => b.i !== 0);
  st.balls = balls;
  st.turn = cont ? seat : other;
  st.ballInHand = foul ? "any" : null;
  if (!balls.some((b) => b.i === 0) && !foul) st.ballInHand = "any";
  return { foul, reason, winner: null, cont };
}

// Bilgisayar oyuncu: aday vuruşları simüle edip en iyisini seçer, sonra beceriye göre sapma ekler.
// skill: 0 (kolay) .. 2 (zor)
export function botShot(st, seat, rnd = Math.random, skill = 1) {
  let balls = st.balls.slice();
  let cuePos = null;
  if (st.ballInHand || !balls.some((b) => b.i === 0)) {
    const kitchen = st.ballInHand === "kitchen";
    const opts = kitchen ? [[200, 250], [150, 200], [150, 300], [220, 150], [220, 350]] : [[250, 250], [500, 250], [750, 120], [750, 380], [300, 120], [300, 380], [600, 250], [850, 250]];
    const ok = opts.filter(([x, y]) => canPlace(balls, x, y, kitchen));
    const [x, y] = ok.length ? ok[Math.floor(rnd() * ok.length)] : [100, 250];
    cuePos = { x, y };
    balls = balls.filter((b) => b.i !== 0).concat([{ i: 0, x, y }]);
  }
  const cue = balls.find((b) => b.i === 0);
  const mine = st.groups ? st.groups[seat] : null;
  const targets = balls.filter((b) => {
    if (b.i === 0) return false;
    if (!st.broken) return false;
    if (!mine) return b.i !== 8;
    return remaining(balls, mine) === 0 ? b.i === 8 : typeOf(b.i) === mine;
  });
  // açış: rasgele sertçe
  if (!st.broken) {
    const dx = FOOT[0] - cue.x, dy = FOOT[1] + (rnd() - 0.5) * 8 - cue.y;
    return { cue: cuePos, dir: { x: dx, y: dy }, power: 0.9 + rnd() * 0.1 };
  }
  const cands = [];
  for (const t of targets) {
    for (const [px, py] of POCKETS) {
      const tx = px - t.x, ty = py - t.y, tl = Math.sqrt(tx * tx + ty * ty);
      const gx = t.x - (tx / tl) * 2 * R, gy = t.y - (ty / tl) * 2 * R;
      const ax = gx - cue.x, ay = gy - cue.y, al = Math.sqrt(ax * ax + ay * ay);
      const cos = (ax * tx + ay * ty) / (al * tl);
      if (cos < 0.25) continue; // çok ince kesme
      cands.push({ dir: { x: ax, y: ay }, score: cos * 2 - (al + tl) / 1500 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let best = null;
  const tryShot = (dir, power) => {
    const sim = simulate(balls, dir, power);
    const test = { balls: balls.slice(), groups: st.groups ? st.groups.slice() : null, turn: seat, ballInHand: null, broken: true };
    const r = applyShot(test, seat, sim, balls);
    let sc = 0;
    if (r.winner === seat) sc = 1000; else if (r.winner != null) sc = -1000;
    else if (r.foul) sc = -50; else if (r.cont) sc = 100; else sc = 0;
    sc += rnd() * 5;
    if (!best || sc > best.sc) best = { dir, power, sc };
  };
  for (const c of cands.slice(0, 10)) for (const p of [0.45, 0.7]) tryShot(c.dir, p);
  if (!best || best.sc < 50) {
    // güvenli vuruş: kendi grubundan en yakın topa direkt
    for (const t of targets.length ? targets : balls.filter((b) => b.i !== 0)) tryShot({ x: t.x - cue.x, y: t.y - cue.y }, 0.5);
  }
  if (!best) best = { dir: { x: 1, y: 0 }, power: 0.5 };
  // beceriye göre sapma
  const noise = [0.045, 0.022, 0.009, 0.0035][Math.max(0, Math.min(3, skill))];
  const a = Math.atan2(best.dir.y, best.dir.x) + (rnd() - 0.5) * 2 * noise;
  return { cue: cuePos, dir: { x: Math.cos(a), y: Math.sin(a) }, power: Math.max(0.1, Math.min(1, best.power + (rnd() - 0.5) * 0.1)) };
}
