// Domino sunucusu (2 kişilik, çekmeli). Taşlar sunucuda dağıtılır.
//   games/{id}               herkese açık durum: zincir, sayılar
//   games/{id}/hands/{uid}   oyuncunun kendi taşları (sadece kendisi okur)
//   gsecret/{id}             pazar (çekilecek taşlar) ve eller (istemcilere kapalı)
import { activeBan } from "../lib/moderation.mjs";
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as K from "../lib/domino.mjs";
import * as E from "../lib/economy.mjs";
import { areFriends } from "../lib/friends.mjs";
import { FieldValue } from "firebase-admin/firestore";

const BOT_NAMES = ["Bot Kemal", "Bot Elif"];
const TYPE = "domino";
const IDLE_MS = 45 * 1000;

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
        type: TYPE, conv: pub ? null : b.conv, public: pub, members, host: uid, status: "lobby", stake, pot: 0, paid: [],
        botSkill: E.botSkillFor(lvl, stake), seats: [{ uid, bot: false }, null], hands: Math.max(1, Math.min(5, Math.floor(Number(b.hands) || 1))),
        at: Date.now(), updatedAt: Date.now(), round: 0, scores: [0, 0], seq: 0, v: 1,
      });
      return json(200, { id: ref.id });
    }

    const id = String(b?.id || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return json(400, { error: "id" });
    const gref = db.doc(`games/${id}`), sref = db.doc(`gsecret/${id}`);

    const result = await db.runTransaction(async (tx) => {
      const gs = await tx.get(gref);
      if (!gs.exists) return { status: 404, body: { error: "game" } };
      const g = gs.data();
      g.gid = id;
      if (g.type !== TYPE) return { status: 400, body: { error: "type" } };
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
        for (const u of seated) if (stake) { E.credit(tx, db, u, wallets[u], -stake, "Domino masa ücreti"); st.pot += stake; st.paid.push(u); }
        const sec = K.deal();
        Object.assign(st, {
          status: "play", settled: false, winner: null, final: null, chain: [], passes: 0,
          turn: act === "start" ? Math.floor(Math.random() * 2) : 1 - (g.dealer ?? 0), round: (g.round || 0) + 1,
          seq: (g.seq || 0) + 1, lastMoveAt: Date.now(), last: null, log: "Taşlar dağıtıldı",
        });
        st.dealer = 1 - st.turn;
        st.firstTurn = st.turn; st.handNo = 1; st.matchPts = [0, 0]; st.prevFinal = null;
        const hands = {};
        runBots(st, sec);
        commit(tx, db, gref, sref, id, st, sec, wallets, hands);
        return { status: 200, body: { ok: true } };
      }

      if (g.status !== "play") return { status: 409, body: { error: "notplaying" } };
      const ss = await tx.get(sref);
      const raw = ss.data();
      if (!raw) return { status: 409, body: { error: "state" } };
      const two = (m) => [m?.[0] || m?.["0"] || [], m?.[1] || m?.["1"] || []];
      const sec = { ...raw, hands: two(raw.hands) };
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
        runBots(st, sec);
        commit(tx, db, gref, sref, id, st, sec, wallets, {}, uid);
        return { status: 200, body: { ok: true } };
      }
      if (act === "poke") {
        if (st.seats[st.turn].bot || Date.now() - (st.lastMoveAt || 0) < IDLE_MS) return { status: 200, body: { ok: true, idle: false } };
        botTurn(st, sec, st.turn, 0);
        runBots(st, sec);
        commit(tx, db, gref, sref, id, st, sec, wallets);
        return { status: 200, body: { ok: true, idle: true } };
      }
      if (act === "play" || act === "draw" || act === "pass") {
        if (mySeat < 0) return { status: 403, body: { error: "seat" } };
        if (st.turn !== mySeat) return { status: 409, body: { error: "turn" } };
        const hand = sec.hands[mySeat], can = K.playable(st.chain || [], hand);
        if (act === "play") {
          const id = Number(b.tile), side = b.side === "L" ? "L" : "R";
          if (!Number.isInteger(id) || !hand.includes(id)) return { status: 400, body: { error: "tile" } };
          if (!K.sides(st.chain || [], id).includes(side)) return { status: 400, body: { error: "side" } };
          play(st, sec, mySeat, id, side);
        } else if (act === "draw") {
          if (can.length || !sec.bone.length) return { status: 409, body: { error: "nodraw" } };
          drawOne(st, sec, mySeat);
        } else {
          if (can.length || sec.bone.length) return { status: 409, body: { error: "nopass" } };
          pass(st, sec, mySeat);
        }
        runBots(st, sec);
        commit(tx, db, gref, sref, id, st, sec, wallets);
        return { status: 200, body: { ok: true } };
      }
      return { status: 400, body: { error: "action" } };
    });
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { error: "server", detail: String((e && e.message) || e).slice(0, 200) });
  }
};

function play(st, sec, seat, id, side) {
  st.chain = K.place(st.chain || [], id, side);
  sec.hands[seat] = sec.hands[seat].filter((x) => x !== id);
  st.passes = 0;
  st.last = { seat, tile: id, side, at: Date.now() };
  const name = st.seats[seat].bot ? st.seats[seat].name + ": " : "";
  st.log = name + K.TILES[id].join("-") + " koydu";
  bump(st);
  if (!sec.hands[seat].length) return end(st, sec, seat, "out");
  st.turn = 1 - seat;
}
function drawOne(st, sec, seat) {
  sec.hands[seat].push(sec.bone.pop());
  st.last = { seat, draw: true, at: Date.now() };
  st.log = (st.seats[seat].bot ? st.seats[seat].name : "Oyuncu") + " pazardan taş çekti";
  bump(st);
}
function pass(st, sec, seat) {
  st.passes = (st.passes || 0) + 1;
  st.last = { seat, pass: true, at: Date.now() };
  st.log = (st.seats[seat].bot ? st.seats[seat].name : "Oyuncu") + " pas geçti";
  bump(st);
  if (st.passes >= 2) return end(st, sec, null, "block");
  st.turn = 1 - seat;
}
function bump(st) { st.seq = (st.seq || 0) + 1; st.lastMoveAt = Date.now(); }
// El sonu: biri bitirirse ya da oyun kilitlenirse (iki pas) eldeki puanı az olan kazanır
function end(st, sec, seat, how) {
  const S = sec;
  const p = [K.handPips(S.hands[0]), K.handPips(S.hands[1])];
  let w = seat;
  if (how === "block") w = p[0] === p[1] ? null : p[0] < p[1] ? 0 : 1;
  const gain = w == null ? 0 : p[1 - w];
  // çok elli maç: eli kazanan rakibin elinde kalan puanı alır, son elden sonra toplamı yüksek olan kazanır
  st.matchPts = (st.matchPts || [0, 0]).map((x, i) => x + (w === i ? gain : 0));
  const total = st.hands || 1, hn = st.handNo || 1;
  const handLog = w == null ? `El kilitlendi, berabere (${p[0]}-${p[1]})` : how === "out" ? `${st.seats[w].bot ? st.seats[w].name : "Oyuncu"} taşlarını bitirdi, +${gain} puan` : `El kilitlendi, az puanlı kazandı: +${gain}`;
  if (hn < total) {
    st.prevFinal = { pips: p, how, w, gain, handNo: hn, hands: { 0: S.hands[0].slice(), 1: S.hands[1].slice() }, at: Date.now() };
    st.handNo = hn + 1;
    Object.assign(sec, K.deal());
    st.chain = []; st.passes = 0; st.last = null;
    st.turn = ((st.firstTurn ?? 0) + hn) % 2;
    st.log = `${hn}. el: ${handLog} · ${hn + 1}. el başladı`;
    return;
  }
  const mp = st.matchPts;
  const mw = total > 1 ? (mp[0] === mp[1] ? null : mp[0] > mp[1] ? 0 : 1) : w;
  st.final = { pips: p, how, hands: { 0: S.hands[0].slice(), 1: S.hands[1].slice() }, match: mp };
  st.winner = mw;
  st.scores = (st.scores || [0, 0]).map((x, i) => x + (mw === i ? 1 : 0));
  st.points = Math.max(1, Math.min(10, Math.round((total > 1 ? Math.abs(mp[0] - mp[1]) : gain) / 5) + 1));
  st.status = "over";
  st.log = total > 1 ? `Maç bitti (${total} el): ${mp[0]} - ${mp[1]}` : mw == null ? `Oyun kilitlendi, berabere (${p[0]}-${p[1]})` : handLog;
}

// Bilgisayarın sırası: oynayabiliyorsa oynar, yoksa pazardan çeker, o da yoksa pas
function botTurn(st, sec, seat, skill) {
  let guard = 0;
  while (st.status === "play" && st.turn === seat && guard++ < 30) {
    const mv = K.botMove(st.chain || [], sec.hands[seat], skill);
    if (mv) { play(st, sec, seat, mv.id, mv.side); break; }
    if (sec.bone.length) { drawOne(st, sec, seat); continue; }
    pass(st, sec, seat); break;
  }
}
function runBots(st, sec) {
  let guard = 0;
  while (st.status === "play" && st.seats[st.turn]?.bot && guard++ < 60) botTurn(st, sec, st.turn, st.botSkill ?? 1);
}

function commit(tx, db, gref, sref, id, st, sec, wallets, _h, removedUid) {
  settle(tx, db, st, wallets);
  for (const [u, w] of Object.entries(wallets)) if (w) tx.set(db.doc(`wallets/${u}`), w);
  st.boneN = sec.bone.length;
  st.handCounts = sec.hands.map((h) => h.length);
  st.updatedAt = Date.now();
  tx.set(gref, st);
  // Firestore iç içe dizi saklayamaz: eller {0:[..],1:[..]} biçiminde
  tx.set(sref, { bone: sec.bone, hands: { 0: sec.hands[0], 1: sec.hands[1] } });
  st.seats.forEach((s, i) => { if (!s.bot) tx.set(db.doc(`games/${id}/hands/${s.uid}`), { tiles: sec.hands[i] }); });
  if (removedUid) tx.delete(db.doc(`games/${id}/hands/${removedUid}`));
}

function settle(tx, db, st, wallets) {
  if (st.status !== "over" || st.settled) return;
  st.settled = true;
  const w = st.winner;
  const draw = w == null;
  const winnerUid = !draw && !st.seats[w].bot ? st.seats[w].uid : null;
  const humanPot = st.pot || 0;
  if (humanPot || st.botStake) {
    if (draw) {
      for (const u of st.paid || []) if (wallets[u]) E.credit(tx, db, u, wallets[u], st.stake, "Domino beraberlik: masa ücreti iadesi");
      st.payout = { refund: true };
    } else if (winnerUid && wallets[winnerUid]) {
      const total = humanPot + (st.botStake || 0);
      const rake = Math.round(total * E.RAKE);
      E.credit(tx, db, winnerUid, wallets[winnerUid], total - rake, "Domino kazanç");
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
    E.afterGame(tx, db, s.uid, wallets[s.uid], { won, draw, type: TYPE, stake: st.stake, delta, opp: humansAll.filter((u) => u !== s.uid), gid: st.gid || "g", round: st.round || 1, points: st.points });
  }
  st.pot = 0;
}

function houseLog(tx, db, net, parts) {
  tx.set(db.doc("house/stats"), { net: FieldValue.increment(net), rake: FieldValue.increment(parts.rake || 0), botWin: FieldValue.increment(parts.botWin || 0), botStake: FieldValue.increment(parts.botStake || 0), hands: FieldValue.increment(1) }, { merge: true });
  tx.set(db.collection("house_ledger").doc(), { net, ...parts, at: Date.now() });
}

export const config = { path: "/api/domino" };
