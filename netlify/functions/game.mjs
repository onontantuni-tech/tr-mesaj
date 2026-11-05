// Oyun sunucusu. Bütün hamleler buradan geçer; deste ve eller sunucuda tutulur.
// Firestore:
//   games/{id}            herkese açık masa durumu (sadece masadaki sohbetin üyeleri okur)
//   games/{id}/hands/{uid} oyuncunun kendi taşları (sadece kendisi okur)
//   gsecret/{id}          deste ve bilgisayar oyuncuların elleri (istemcilere kapalı)
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as O from "../lib/okey.mjs";

const BOT_NAMES = ["Bot Ayşe", "Bot Mehmet", "Bot Zeynep", "Bot Ali"];
const IDLE_MS = 45 * 1000; // sırası gelen oyuncu bu kadar oynamazsa onun yerine otomatik oynanır

const next = (i) => (i + 1) % 4;
const prev = (i) => (i + 3) % 4;

async function convMembers(db, uid, conv) {
  if (typeof conv !== "string" || !conv) return null;
  if (conv.startsWith("g:")) {
    const g = await db.doc(`groups/${conv.slice(2)}`).get();
    if (!g.exists) return null;
    const m = g.data().members || [];
    return m.includes(uid) ? m.slice(0, 50) : null;
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(conv) || conv === uid) return null;
  return [uid, conv];
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  let b;
  try { b = await req.json(); } catch { return json(400, { error: "body" }); }
  const { db } = admin();
  const act = String(b?.action || "");

  try {
    if (act === "create") {
      const type = b.type === "okey" ? "okey" : null;
      if (!type) return json(400, { error: "type" });
      const members = await convMembers(db, uid, b.conv);
      if (!members) return json(403, { error: "conv" });
      const ref = db.collection("games").doc();
      await ref.set({
        type, conv: b.conv, members, host: uid, status: "lobby",
        seats: [{ uid, bot: false }, null, null, null],
        at: Date.now(), updatedAt: Date.now(), round: 0, scores: [0, 0, 0, 0], v: 1,
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
      if (!g.members.includes(uid)) return { status: 403, body: { error: "member" } };
      const mySeat = g.seats.findIndex((s) => s && !s.bot && s.uid === uid);

      // Masaya otur / kalk (lobide)
      if (act === "join") {
        if (g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (mySeat >= 0) return { status: 200, body: { ok: true } };
        const free = g.seats.findIndex((s) => !s);
        if (free < 0) return { status: 409, body: { error: "full" } };
        g.seats[free] = { uid, bot: false };
        tx.update(gref, { seats: g.seats, updatedAt: Date.now() });
        return { status: 200, body: { ok: true } };
      }
      if (act === "leave" && g.status === "lobby") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        g.seats[mySeat] = null;
        const upd = { seats: g.seats, updatedAt: Date.now() };
        if (g.host === uid) { const h = g.seats.find((s) => s && !s.bot); upd.host = h ? h.uid : uid; if (!h) upd.status = "closed"; }
        tx.update(gref, upd);
        return { status: 200, body: { ok: true } };
      }

      // Başlat / yeni el
      if (act === "start" || act === "again") {
        if (g.host !== uid) return { status: 403, body: { error: "host" } };
        if (act === "start" && g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (act === "again" && g.status !== "over") return { status: 409, body: { error: "notover" } };
        let bi = 0;
        g.seats = g.seats.map((s) => s || { uid: null, bot: true, name: BOT_NAMES[bi++ % 4] });
        const dealer = act === "start" ? Math.floor(Math.random() * 4) : next(g.dealer ?? 0);
        const d = O.deal(dealer);
        const secret = { pile: d.pile, bots: {} };
        const st = {
          ...g, status: "play", dealer, turn: dealer, phase: "discard", indicator: d.indicator,
          discards: { 0: [], 1: [], 2: [], 3: [] }, pileCount: d.pile.length,
          handCounts: d.hands.map((h) => h.length), winner: null, winKind: null, winHand: null,
          round: (g.round || 0) + 1, lastMoveAt: Date.now(), updatedAt: Date.now(), log: "Oyun başladı",
        };
        const hands = {};
        g.seats.forEach((s, i) => { if (s.bot) secret.bots[i] = d.hands[i]; else hands[s.uid] = d.hands[i]; });
        runBots(st, secret, hands);
        writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }

      if (g.status !== "play") return { status: 409, body: { error: "notplaying" } };
      const ss = await tx.get(sref);
      const secret = ss.data();
      const humanUids = g.seats.filter((s) => !s.bot).map((s) => s.uid);
      const handSnaps = await Promise.all(humanUids.map((u) => tx.get(db.doc(`games/${id}/hands/${u}`))));
      const hands = {};
      humanUids.forEach((u, i) => { hands[u] = handSnaps[i].data()?.tiles || []; });
      const st = { ...g };

      // Masadan kalk (oyun sırasında): yerine bilgisayar geçer
      if (act === "leave") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        secret.bots[mySeat] = hands[uid];
        delete hands[uid];
        const used = st.seats.filter((x) => x && x.bot).map((x) => x.name);
        st.seats[mySeat] = { uid: null, bot: true, name: BOT_NAMES.find((n) => !used.includes(n)) || "Bot" };
        st.log = "Bir oyuncu masadan kalktı, yerine bilgisayar geçti";
        runBots(st, secret, hands);
        writeAll(tx, gref, sref, id, st, secret, hands, g.seats, uid);
        return { status: 200, body: { ok: true } };
      }

      // Uzun süre oynamayanın yerine otomatik hamle
      if (act === "poke") {
        const cur = st.seats[st.turn];
        if (cur.bot || Date.now() - (st.lastMoveAt || 0) < IDLE_MS) return { status: 200, body: { ok: true, idle: false } };
        autoMove(st, secret, hands, st.turn);
        runBots(st, secret, hands);
        writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true, idle: true } };
      }

      if (mySeat < 0) return { status: 403, body: { error: "seat" } };
      if (st.turn !== mySeat) return { status: 409, body: { error: "turn" } };
      const hand = hands[uid];
      const okey = O.okeyOf(st.indicator);

      if (act === "draw") {
        if (st.phase !== "draw") return { status: 409, body: { error: "phase" } };
        const from = b.from === "left" ? "left" : "pile";
        if (from === "left") {
          const pd = st.discards[prev(mySeat)];
          if (!pd.length) return { status: 409, body: { error: "empty" } };
          hand.push(pd.pop());
          st.log = "Soldan aldı";
        } else {
          if (!secret.pile.length) { endDraw(st); writeAll(tx, gref, sref, id, st, secret, hands, g.seats); return { status: 200, body: { ok: true } }; }
          hand.push(secret.pile.pop());
          st.log = "Ortadan çekti";
        }
        st.phase = "discard";
        st.lastMoveAt = Date.now();
        writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }

      if (act === "discard" || act === "finish") {
        if (st.phase !== "discard") return { status: 409, body: { error: "phase" } };
        const t = Number(b.tile);
        const idx = hand.indexOf(t);
        if (idx < 0) return { status: 400, body: { error: "tile" } };
        if (act === "finish") {
          const rest = hand.filter((_, i) => i !== idx);
          const kind = O.winKind(rest, okey);
          if (!kind) return { status: 200, body: { ok: false, error: "nowin" } };
          hand.splice(idx, 1);
          st.discards[mySeat].push(t);
          finish(st, mySeat, kind, rest, O.valueOf(t, okey) === "W");
          writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
          return { status: 200, body: { ok: true, win: kind } };
        }
        hand.splice(idx, 1);
        st.discards[mySeat].push(t);
        st.turn = next(mySeat);
        st.phase = "draw";
        st.lastMoveAt = Date.now();
        st.log = "Taş attı";
        runBots(st, secret, hands);
        writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }

      return { status: 400, body: { error: "action" } };
    });
    return json(result.status, result.body);
  } catch (e) {
    return json(500, { error: "server", detail: String(e && e.message || e).slice(0, 200) });
  }
};

/* ---------------- yardımcılar ---------------- */

function handOf(st, secret, hands, seat) {
  const s = st.seats[seat];
  return s.bot ? secret.bots[seat] : hands[s.uid];
}

function finish(st, seat, kind, rest, withOkey) {
  st.status = "over";
  st.winner = seat;
  st.winKind = kind;
  st.winHand = rest;
  let pts = kind === "cift" ? 4 : 2;
  if (withOkey) pts *= 2;
  st.scores = (st.scores || [0, 0, 0, 0]).slice();
  st.scores[seat] += pts;
  st.points = pts;
  st.log = `${kind === "cift" ? "Çiftten" : "Seriden"} bitti${withOkey ? ", okey atarak" : ""}`;
}

function endDraw(st) {
  st.status = "over";
  st.winner = null;
  st.winKind = "berabere";
  st.log = "Deste bitti, el berabere";
}

// Bir oyuncu (bot veya bekleyen insan) için tek hamle: çek + (bitir | at)
function autoMove(st, secret, hands, seat) {
  const okey = O.okeyOf(st.indicator);
  const hand = handOf(st, secret, hands, seat);
  if (st.phase === "draw") {
    const pd = st.discards[prev(seat)];
    const top = pd.length ? pd[pd.length - 1] : null;
    const ch = O.botChooseDraw(hand, top, okey);
    if (ch === "left" && top != null) hand.push(pd.pop());
    else {
      if (!secret.pile.length) { endDraw(st); return; }
      hand.push(secret.pile.pop());
    }
    st.phase = "discard";
  }
  const fin = O.findFinish(hand, okey);
  if (fin) {
    hand.splice(hand.indexOf(fin.tile), 1);
    st.discards[seat].push(fin.tile);
    finish(st, seat, fin.kind, hand.slice(), O.valueOf(fin.tile, okey) === "W");
    return;
  }
  const t = O.botChooseDiscard(hand, okey);
  hand.splice(hand.indexOf(t), 1);
  st.discards[seat].push(t);
  st.turn = next(seat);
  st.phase = "draw";
  st.lastMoveAt = Date.now();
  st.log = `${st.seats[seat].bot ? st.seats[seat].name : "Otomatik"} taş attı`;
}

function runBots(st, secret, hands) {
  let guard = 0;
  while (st.status === "play" && st.seats[st.turn].bot && guard++ < 8) autoMove(st, secret, hands, st.turn);
}

function writeAll(tx, gref, sref, id, st, secret, hands, oldSeats, removedUid) {
  st.pileCount = secret.pile.length;
  st.handCounts = st.seats.map((s, i) => (handOf(st, secret, hands, i) || []).length);
  st.updatedAt = Date.now();
  const pub = { ...st };
  tx.set(gref, pub);
  tx.set(sref, { pile: secret.pile, bots: secret.bots });
  const db = gref.firestore;
  for (const [u, tiles] of Object.entries(hands)) tx.set(db.doc(`games/${id}/hands/${u}`), { tiles });
  if (removedUid) tx.delete(db.doc(`games/${id}/hands/${removedUid}`));
}

export const config = { path: "/api/game" };
