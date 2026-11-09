// Kızma Birader sunucusu (4 kişilik). Zar sunucuda atılır.
// games/{id}: type "kizma", kz {pos}, die, turn. Gizli bilgi yok.
import { activeBan } from "../lib/moderation.mjs";
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as T from "../lib/kizma.mjs";
import * as E from "../lib/economy.mjs";
import { areFriends } from "../lib/friends.mjs";
import { FieldValue } from "firebase-admin/firestore";

const BOT_NAMES = ["Bot Kemal", "Bot Elif", "Bot Ayşe", "Bot Mehmet"];
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
        type: "kizma", conv: pub ? null : b.conv, public: pub, members, host: uid, status: "lobby", stake, pot: 0, paid: [],
        botSkill: E.botSkillFor(lvl, stake), seats: [{ uid, bot: false }, null, null, null],
        at: Date.now(), updatedAt: Date.now(), round: 0, scores: [0, 0, 0, 0], seq: 0, v: 1,
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
      if (g.type !== "kizma") return { status: 400, body: { error: "type" } };
      if (!g.members.includes(uid) && !(g.public && act === "join")) return { status: 403, body: { error: "member" } };
      let auto = false;
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
        else { tx.update(gref, { seats: g.seats, members: g.members, updatedAt: Date.now() }); return { status: 200, body: { ok: true } }; }
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
      if (act === "poke" && g.status === "lobby") {
        if (!g.public || mySeat < 0 || Date.now() - (g.at || 0) < 20000) return { status: 200, body: { ok: true, idle: false } };
        act = "start"; auto = true;
      }

      // Başlat / yeni el
      if (act === "start" || act === "again") {
        if (g.host !== uid && !auto) return { status: 403, body: { error: "host" } };
        if (act === "start" && g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (act === "again" && g.status !== "over") return { status: 409, body: { error: "notover" } };
        const seated = g.seats.filter((s) => s && !s.bot).map((s) => s.uid);
        const wsn = await Promise.all(seated.map((u) => tx.get(db.doc(`wallets/${u}`))));
        const wallets = {};
        seated.forEach((u, i) => { wallets[u] = wsn[i].exists ? wsn[i].data() : null; });
        const stake = g.stake || 0;
        if (stake) {
          const poor = seated.filter((u) => !wallets[u] || (wallets[u].balance || 0) < stake || !wallets[u].adult);
          if (poor.length) return { status: 402, body: { error: "balance", who: poor } };
        }
        const st = { ...g };
        st.seats = g.seats.map((s, i) => s || { uid: null, bot: true, name: BOT_NAMES[i] });
        st.paid = []; st.pot = 0; st.payout = null;
        st.botStake = st.seats.some((s) => s && s.bot) ? Math.round(stake * E.BOT_BONUS) : 0; // bilgisayar masaya para koymaz, kasa küçük bir ödül ekler
        for (const u of seated) if (stake) { E.credit(tx, db, u, wallets[u], -stake, "Kızma Birader masa ücreti"); st.pot += stake; st.paid.push(u); }
        Object.assign(st, {
          status: "play", settled: false, winner: null, kz: T.newGame(),
          turn: act === "start" ? Math.floor(Math.random() * 4) : ((g.starter ?? 0) + 1) % 4, round: (g.round || 0) + 1,
          seq: (g.seq || 0) + 1, lastMoveAt: Date.now(), last: null, hist: [], log: "Oyun başladı",
        });
        st.starter = st.turn;
        st.die = T.roll();
        advance(st);
        commit(tx, db, gref, st, wallets);
        return { status: 200, body: { ok: true } };
      }

      if (g.status !== "play") return { status: 409, body: { error: "notplaying" } };
      const humanUids = g.seats.filter((s) => !s.bot).map((s) => s.uid);
      const walletUids = [...new Set([...humanUids, ...(g.paid || [])])];
      const wSnaps = await Promise.all(walletUids.map((u) => tx.get(db.doc(`wallets/${u}`))));
      const wallets = {};
      walletUids.forEach((u, i) => { wallets[u] = wSnaps[i].exists ? wSnaps[i].data() : null; });
      const st = { ...g };

      if (act === "leave") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        st.seats[mySeat] = { uid: null, bot: true, name: BOT_NAMES[mySeat] };
        st.log = "Bir oyuncu masadan kalktı, yerine bilgisayar geçti";
        advance(st);
        commit(tx, db, gref, st, wallets);
        return { status: 200, body: { ok: true } };
      }
      if (act === "poke") {
        if (st.seats[st.turn].bot || Date.now() - (st.lastMoveAt || 0) < IDLE_MS) return { status: 200, body: { ok: true, idle: false } };
        doMove(st, st.turn, T.botMove(st.kz, st.turn, st.die, 0));
        advance(st);
        commit(tx, db, gref, st, wallets);
        return { status: 200, body: { ok: true, idle: true } };
      }
      if (act === "move") {
        if (mySeat < 0) return { status: 403, body: { error: "seat" } };
        if (st.turn !== mySeat) return { status: 409, body: { error: "turn" } };
        const k = Number(b.k);
        const m = T.moves(st.kz, mySeat, st.die).find((x) => x.k === k);
        if (!m) return { status: 400, body: { error: "illegal" } };
        doMove(st, mySeat, m);
        advance(st);
        commit(tx, db, gref, st, wallets);
        return { status: 200, body: { ok: true } };
      }
      return { status: 400, body: { error: "action" } };
    });
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { error: "server", detail: String((e && e.message) || e).slice(0, 200) });
  }
};

const COLORS = ["Kırmızı", "Mavi", "Yeşil", "Sarı"];
function doMove(st, seat, m) {
  const name = st.seats[seat].bot ? st.seats[seat].name : COLORS[seat];
  const P = (kz, p) => (kz.pos[p] || kz.pos[String(p)] || []);
  let h;
  if (m) {
    const from = P(st.kz, seat)[m.k];
    const r = T.apply(st.kz, seat, m);
    let hitK = null;
    if (r.hit != null) { const a = P(st.kz, r.hit), b2 = P(r.s, r.hit); hitK = a.findIndex((x, i) => x !== b2[i]); }
    st.kz = r.s;
    st.last = { seat, k: m.k, to: m.to, die: st.die, hit: r.hit, at: Date.now() };
    h = { seat, k: m.k, from, to: m.to, die: st.die, hit: r.hit ?? null, hitK };
    st.log = r.hit != null ? `${name} ${st.die} attı ve ${COLORS[r.hit]} piyonu eve yolladı! 😤` : m.to >= 40 && m.to - st.die < 40 ? `${name} bir piyonu eve soktu` : `${name} ${st.die} attı`;
  } else { st.last = { seat, die: st.die, at: Date.now() }; st.log = `${name} ${st.die} attı · oynayacak piyon yok`; h = { seat, die: st.die }; }
  st.seq = (st.seq || 0) + 1; st.lastMoveAt = Date.now();
  // son hamleler: istemci bunları sırayla, piyonu kare kare zıplatarak oynatır
  st.hist = [...(st.hist || []), { ...h, n: st.seq }].slice(-16);
  if (T.won(st.kz, seat)) {
    st.status = "over"; st.winner = seat; st.die = null;
    st.scores = (st.scores || [0, 0, 0, 0]).map((x, i) => x + (i === seat ? 1 : 0));
    st.points = 3; st.log = `${name} kazandı!`;
    return;
  }
  if (st.die !== 6) st.turn = (seat + 1) % 4;
  st.die = T.roll();
}
function advance(st) {
  let guard = 0;
  while (st.status === "play" && guard++ < 400) {
    const seat = st.turn;
    if (st.seats[seat]?.bot) { doMove(st, seat, T.botMove(st.kz, seat, st.die, st.botSkill ?? 1)); continue; }
    if (!T.moves(st.kz, seat, st.die).length) { doMove(st, seat, null); continue; }
    break;
  }
}

function commit(tx, db, gref, st, wallets) {
  settle(tx, db, st, wallets);
  for (const [u, w] of Object.entries(wallets)) if (w) tx.set(db.doc(`wallets/${u}`), w);
  st.updatedAt = Date.now();
  tx.set(gref, st);
}

function settle(tx, db, st, wallets) {
  if (st.status !== "over" || st.settled) return;
  st.settled = true;
  const w = st.winner;
  const draw = false;
  const winnerUid = !draw && !st.seats[w].bot ? st.seats[w].uid : null;
  const humanPot = st.pot || 0;
  if (humanPot || st.botStake) {
    if (draw) {
      for (const u of st.paid || []) if (wallets[u]) E.credit(tx, db, u, wallets[u], st.stake, "Kızma Birader: masa ücreti iadesi");
      st.payout = { refund: true };
    } else if (winnerUid && wallets[winnerUid]) {
      const total = humanPot + (st.botStake || 0);
      const rake = Math.round(total * E.RAKE);
      E.credit(tx, db, winnerUid, wallets[winnerUid], total - rake, "Kızma Birader kazanç");
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
    const won = s.uid === winnerUid;
    const delta = draw ? 0 : won ? (st.payout?.amount || 0) - (st.stake || 0) : -(st.stake || 0);
    E.afterGame(tx, db, s.uid, wallets[s.uid], { won, draw, type: "kizma", stake: st.stake, delta, opp: humansAll.filter((u) => u !== s.uid), gid: st.gid || "g", round: st.round || 1, points: st.points });
  }
  st.pot = 0;
}

function houseLog(tx, db, net, parts) {
  tx.set(db.doc("house/stats"), { net: FieldValue.increment(net), rake: FieldValue.increment(parts.rake || 0), botWin: FieldValue.increment(parts.botWin || 0), botStake: FieldValue.increment(parts.botStake || 0), hands: FieldValue.increment(1) }, { merge: true });
  tx.set(db.collection("house_ledger").doc(), { net, ...parts, at: Date.now() });
}

export const config = { path: "/api/kizma" };
