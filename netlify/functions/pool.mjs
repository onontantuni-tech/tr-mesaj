// Bilardo (8 top) sunucusu. Vuruşlar burada simüle edilir; istemci sadece açı ve güç gönderir.
// games/{id}: type "pool", seats [2], balls, groups, turn, ballInHand, lastShots (tekrar animasyonu için)
import { activeBan } from "../lib/moderation.mjs";
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as P from "../lib/pool.mjs";
import * as E from "../lib/economy.mjs";
import { areFriends } from "../lib/friends.mjs";
import { FieldValue } from "firebase-admin/firestore";

const BOT_NAMES = ["Bot Kemal", "Bot Elif"];
const IDLE_MS = 60 * 1000;

async function convMembers(db, uid, conv) {
  if (typeof conv !== "string" || !conv) return null;
  if (conv.startsWith("g:")) {
    const g = await db.doc(`groups/${conv.slice(2)}`).get();
    if (!g.exists) return null;
    const m = g.data().members || [];
    return m.includes(uid) ? m.slice(0, 50) : null;
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(conv) || conv === uid) return null;
  if (!(await areFriends(db, uid, conv))) return null;
  return [uid, conv];
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : NaN);

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  if (await activeBan(admin().db, uid)) return json(403, { error: "banned" });
  let b;
  try { b = await req.json(); } catch { return json(400, { error: "body" }); }
  const { db } = admin();
  let act = String(b?.action || "");

  try {
    if (act === "create") {
      const pub = b.public === true;
      const members = pub ? [uid] : await convMembers(db, uid, b.conv);
      if (!members) return json(403, { error: "conv" });
      const stake = Math.max(0, Math.floor(Number(b.stake) || 0));
      const ws = await db.doc(`wallets/${uid}`).get();
      const lvl = E.levelFromXp(ws.exists ? ws.data().xp || 0 : 0).level;
      const bal = ws.exists ? ws.data().balance || 0 : 0;
      if (stake && bal < stake) return json(402, { error: "balance" });
      if (stake && !(ws.exists && ws.data().adult)) return json(403, { error: "age" });
      if (!E.stakeAllowed(stake, bal)) return json(403, { error: "stake" });
      const ref = db.collection("games").doc();
      await ref.set({
        type: "pool", conv: pub ? null : b.conv, public: pub, members, host: uid, status: "lobby", stake, pot: 0, paid: [], botSkill: E.botSkillFor(lvl, stake),
        seats: [{ uid, bot: false }, null], at: Date.now(), updatedAt: Date.now(), round: 0, scores: [0, 0], seq: 0, v: 1,
      });
      return json(200, { id: ref.id });
    }

    const id = String(b?.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return json(400, { error: "id" });
    const gref = db.doc(`games/${id}`);

    const result = await db.runTransaction(async (tx) => {
      const gs = await tx.get(gref);
      if (!gs.exists) return { status: 404, body: { error: "game" } };
      const g = gs.data();
      g.gid = id;
      if (g.type !== "pool") return { status: 400, body: { error: "type" } };
      if (!g.members.includes(uid) && !(g.public && act === "join")) return { status: 403, body: { error: "member" } };
      let auto = false; // açık masa dolunca ya da süre bitince kendiliğinden başlar
      const mySeat = g.seats.findIndex((s) => s && !s.bot && s.uid === uid);

      if (act === "join") {
        if (g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (mySeat >= 0) return { status: 200, body: { ok: true } };
        if (g.stake) {
          const mw = await tx.get(db.doc(`wallets/${uid}`));
          if (!(mw.exists && mw.data().adult)) return { status: 403, body: { error: "age" } };
          if ((mw.data().balance || 0) < g.stake) return { status: 402, body: { error: "balance" } };
        }
        const free = g.seats.findIndex((s) => !s);
        if (free < 0) return { status: 409, body: { error: "full" } };
        g.seats[free] = { uid, bot: false };
        if (!g.members.includes(uid)) g.members = [...g.members, uid];
        if (g.public && g.seats.every((s) => s)) { act = "start"; auto = true; }
        else {
          tx.update(gref, { seats: g.seats, members: g.members, updatedAt: Date.now() });
          return { status: 200, body: { ok: true } };
        }
      }
      if (act === "leave" && g.status === "lobby") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        g.seats[mySeat] = null;
        const upd = { seats: g.seats, updatedAt: Date.now() };
        if (g.public) upd.members = g.members.filter((x) => x !== uid);
        if (g.host === uid || g.public) { const h = g.seats.find((s) => s && !s.bot); upd.host = h ? h.uid : uid; if (!h) upd.status = "closed"; }
        tx.update(gref, upd);
        return { status: 200, body: { ok: true } };
      }
      // Açık masa: 20 saniye içinde dolmazsa boş yerlere bilgisayar oturur
      if (act === "poke" && g.status === "lobby") {
        if (!g.public || mySeat < 0 || Date.now() - (g.at || 0) < 20000) return { status: 200, body: { ok: true, idle: false } };
        act = "start"; auto = true;
      }

      const humans = [...new Set([...g.seats.filter((s) => s && !s.bot).map((s) => s.uid), ...(g.paid || [])])];
      const wsn = await Promise.all(humans.map((u) => tx.get(db.doc(`wallets/${u}`))));
      const wallets = {};
      humans.forEach((u, i) => { wallets[u] = wsn[i].exists ? wsn[i].data() : null; });
      const st = { ...g };
      const save = () => {
        settle(tx, db, st, wallets);
        for (const [u, w] of Object.entries(wallets)) if (w) tx.set(db.doc(`wallets/${u}`), w);
        st.updatedAt = Date.now();
        tx.set(gref, st);
      };

      if (act === "start" || act === "again") {
        if (g.host !== uid && !auto) return { status: 403, body: { error: "host" } };
        if (act === "start" && g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (act === "again" && g.status !== "over") return { status: 409, body: { error: "notover" } };
        const seated = g.seats.filter((s) => s && !s.bot).map((s) => s.uid);
        const stake = g.stake || 0;
        if (stake) {
          const poor = seated.filter((u) => !wallets[u] || (wallets[u].balance || 0) < stake || !wallets[u].adult);
          if (poor.length) return { status: 402, body: { error: "balance", who: poor } };
        }
        st.seats = g.seats.map((s, i) => s || { uid: null, bot: true, name: BOT_NAMES[i] });
        st.paid = []; st.pot = 0; st.payout = null;
        st.botStake = stake * st.seats.filter((s) => s.bot).length;
        for (const u of seated) if (stake) { E.credit(tx, db, u, wallets[u], -stake, "Bilardo masa ücreti"); st.pot += stake; st.paid.push(u); }
        Object.assign(st, {
          status: "play", balls: P.rack(), groups: null, broken: false, ballInHand: "kitchen", settled: false, winner: null,
          turn: act === "start" ? Math.floor(Math.random() * 2) : 1 - (g.breaker ?? 0), round: (g.round || 0) + 1,
          lastShots: [], seq: (g.seq || 0) + 1, lastMoveAt: Date.now(), log: "Oyun başladı · açış vuruşu",
        });
        st.breaker = st.turn;
        runBots(st);
        save();
        return { status: 200, body: { ok: true } };
      }

      if (g.status !== "play") return { status: 409, body: { error: "notplaying" } };

      if (act === "leave") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        st.seats[mySeat] = { uid: null, bot: true, name: BOT_NAMES[mySeat] };
        st.lastShots = []; st.seq = (st.seq || 0) + 1;
        st.log = "Bir oyuncu masadan kalktı, yerine bilgisayar geçti";
        runBots(st);
        save();
        return { status: 200, body: { ok: true } };
      }

      if (act === "poke") {
        const cur = st.seats[st.turn];
        if (cur.bot || Date.now() - (st.lastMoveAt || 0) < IDLE_MS) return { status: 200, body: { ok: true, idle: false } };
        st.lastShots = [];
        const sh = P.botShot(st, st.turn, Math.random, 0);
        doShot(st, st.turn, sh);
        runBots(st);
        st.seq = (st.seq || 0) + 1;
        save();
        return { status: 200, body: { ok: true, idle: true } };
      }

      if (act === "shoot") {
        if (mySeat < 0) return { status: 403, body: { error: "seat" } };
        if (st.turn !== mySeat) return { status: 409, body: { error: "turn" } };
        const dx = num(b.dx), dy = num(b.dy), power = num(b.power);
        if (!(Math.abs(dx) + Math.abs(dy) > 1e-6) || !(power > 0 && power <= 1)) return { status: 400, body: { error: "shot" } };
        let cue = null;
        const hasCue = st.balls.some((x) => x.i === 0);
        if (st.ballInHand || !hasCue) {
          const x = num(b.cx), y = num(b.cy);
          const others = st.balls.filter((q) => q.i !== 0);
          if (isFinite(x) && isFinite(y)) {
            if (!P.canPlace(others, x, y, st.ballInHand === "kitchen")) return { status: 400, body: { error: "place" } };
            cue = { x, y };
          } else if (!hasCue) return { status: 400, body: { error: "place" } };
        }
        st.lastShots = [];
        const sx = num(b.sx), sy = num(b.sy);
        const spin = { x: isFinite(sx) ? Math.max(-1, Math.min(1, sx)) : 0, y: isFinite(sy) ? Math.max(-1, Math.min(1, sy)) : 0 };
        doShot(st, mySeat, { cue, dir: { x: dx, y: dy }, power, spin });
        runBots(st);
        st.seq = (st.seq || 0) + 1;
        save();
        return { status: 200, body: { ok: true } };
      }

      return { status: 400, body: { error: "action" } };
    });
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { error: "server", detail: String((e && e.message) || e).slice(0, 200) });
  }
};

// Bir vuruş: simüle et, kuralları uygula, tekrar için kaydet
function doShot(st, seat, sh) {
  let before = st.balls.slice();
  if (sh.cue) before = before.filter((x) => x.i !== 0).concat([{ i: 0, x: sh.cue.x, y: sh.cue.y }]);
  const res = P.simulate(before, sh.dir, sh.power, null, sh.spin);
  const r = P.applyShot(st, seat, res, before);
  st.lastShots = [...(st.lastShots || []), { seat, before, dx: sh.dir.x, dy: sh.dir.y, power: sh.power, sx: (sh.spin && sh.spin.x) || 0, sy: (sh.spin && sh.spin.y) || 0, pocketed: res.pocketed, foul: r.foul, reason: r.reason || "" }].slice(-30);
  st.lastMoveAt = Date.now();
  const name = st.seats[seat].bot ? st.seats[seat].name : null;
  if (r.winner != null) {
    st.status = "over"; st.winner = r.winner;
    st.scores = (st.scores || [0, 0]).slice(); st.scores[r.winner] += 1;
    st.points = 2;
    st.log = r.reason;
  } else {
    const inn = res.pocketed.filter((i) => i !== 0).length;
    st.log = r.foul ? `Faul: ${r.reason}` : inn ? `${inn} top girdi${r.cont ? ", sıra devam" : ""}` : "Top girmedi";
    if (name) st.log = name + ": " + st.log;
  }
}

function runBots(st) {
  let guard = 0;
  while (st.status === "play" && st.seats[st.turn]?.bot && guard++ < 25) {
    const sh = P.botShot(st, st.turn, Math.random, st.botSkill ?? 1);
    doShot(st, st.turn, sh);
  }
}

// Ekonomi: Okey ile aynı kurallar
function settle(tx, db, st, wallets) {
  if (st.status !== "over" || st.settled) return;
  st.settled = true;
  const w = st.winner;
  const winnerUid = w != null && !st.seats[w].bot ? st.seats[w].uid : null;
  const humanPot = st.pot || 0;
  if (humanPot || st.botStake) {
    if (winnerUid && wallets[winnerUid]) {
      const total = humanPot + (st.botStake || 0);
      const rake = Math.round(total * E.RAKE);
      E.credit(tx, db, winnerUid, wallets[winnerUid], total - rake, "Bilardo kazanç");
      st.payout = { uid: winnerUid, amount: total - rake, rake };
      houseLog(tx, db, rake - (st.botStake || 0), { rake, botStake: st.botStake || 0 });
    } else {
      st.payout = { house: true, amount: humanPot };
      houseLog(tx, db, humanPot, { botWin: humanPot });
    }
  }
  const humansAll = st.seats.filter((x) => !x.bot).map((x) => x.uid);
  for (const s of st.seats) {
    if (s.bot || !wallets[s.uid]) continue;
    const won = s.uid === winnerUid, draw = false;
    const delta = draw ? 0 : won ? (st.payout?.amount || 0) - (st.stake || 0) : -(st.stake || 0);
    E.afterGame(tx, db, s.uid, wallets[s.uid], { won, draw, type: "pool", stake: st.stake, delta, opp: humansAll.filter((u) => u !== s.uid), gid: st.gid || "g", round: st.round || 1, points: st.points });
  }
  st.pot = 0;
}

function houseLog(tx, db, net, parts) {
  tx.set(db.doc("house/stats"), { net: FieldValue.increment(net), rake: FieldValue.increment(parts.rake || 0), botWin: FieldValue.increment(parts.botWin || 0), botStake: FieldValue.increment(parts.botStake || 0), hands: FieldValue.increment(1) }, { merge: true });
  tx.set(db.collection("house_ledger").doc(), { net, ...parts, at: Date.now() });
}

export const config = { path: "/api/pool" };
