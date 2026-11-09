// Oyun sunucusu. Bütün hamleler buradan geçer; deste ve eller sunucuda tutulur.
// Firestore:
//   games/{id}            herkese açık masa durumu (sadece masadaki sohbetin üyeleri okur)
//   games/{id}/hands/{uid} oyuncunun kendi taşları (sadece kendisi okur)
//   gsecret/{id}          deste ve bilgisayar oyuncuların elleri (istemcilere kapalı)
import { areFriends } from "../lib/friends.mjs";
import { activeBan } from "../lib/moderation.mjs";
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as O from "../lib/okey.mjs";
import * as E from "../lib/economy.mjs";
import { FieldValue } from "firebase-admin/firestore";

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
      const type = b.type === "okey" ? "okey" : null;
      if (!type) return json(400, { error: "type" });
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
        type, conv: pub ? null : b.conv, public: pub, members, host: uid, status: "lobby", stake, pot: 0, paid: [], botSkill: E.botSkillFor(lvl, stake), turnSec: [15, 30].includes(Number(b.turnSec)) ? Number(b.turnSec) : 0, canak: b.canak === true && stake > 0, canakPot: 0, hostLvl: lvl,
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
      g.gid = id;
      if (g.type && g.type !== "okey") return { status: 400, body: { error: "type" } };
      if (!g.members.includes(uid) && !(g.public && act === "join")) return { status: 403, body: { error: "member" } };
      let auto = false; // açık masa dolunca ya da süre bitince kendiliğinden başlar
      const mySeat = g.seats.findIndex((s) => s && !s.bot && s.uid === uid);

      // Masaya otur / kalk (lobide)
      if (act === "join") {
        if (g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (mySeat >= 0) return { status: 200, body: { ok: true } };
        if ((g.banned || []).includes(uid)) return { status: 403, body: { error: "banned" } };
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

      // Başlat / yeni el
      if (act === "start" || act === "again") {
        if (g.host !== uid && !auto) return { status: 403, body: { error: "host" } };
        if (act === "start" && g.status !== "lobby") return { status: 409, body: { error: "started" } };
        if (act === "again" && g.status !== "over") return { status: 409, body: { error: "notover" } };
        // Masa ücreti: oturan her oyuncudan alınır
        const humansNow = g.seats.filter((s) => s && !s.bot).map((s) => s.uid);
        const wsnaps = await Promise.all(humansNow.map((u) => tx.get(db.doc(`wallets/${u}`))));
        const wallets = {};
        humansNow.forEach((u, i) => { wallets[u] = wsnaps[i].exists ? wsnaps[i].data() : null; });
        const stake = g.stake || 0;
        if (stake) {
          const poor = humansNow.filter((u) => !wallets[u] || (wallets[u].balance || 0) < stake || !wallets[u].adult);
          if (poor.length) return { status: 402, body: { error: "balance", who: poor } };
        }
        let bi = 0;
        g.seats = g.seats.map((s) => s || { uid: null, bot: true, name: BOT_NAMES[bi++ % 4] });
        g.paid = [];
        g.pot = 0;
        // Bilgisayarların masa ücretini kasa öder
        g.botStake = g.seats.some((s) => s && s.bot) ? Math.round(stake * E.BOT_BONUS) : 0; // bilgisayar masaya para koymaz, kasa küçük bir ödül ekler
        for (const u of humansNow) {
          if (stake) { E.credit(tx, db, u, wallets[u], -stake, "Okey masa ücreti"); g.pot += stake; g.paid.push(u); }
        }
        const dealer = act === "start" ? Math.floor(Math.random() * 4) : next(g.dealer ?? 0);
        const d = O.deal(dealer);
        const secret = { pile: d.pile, bots: {} };
        const st = {
          ...g, status: "play", dealer, turn: dealer, phase: "discard", indicator: d.indicator, settled: false,
          discards: { 0: [], 1: [], 2: [], 3: [] }, pileCount: d.pile.length,
          handCounts: d.hands.map((h) => h.length), winner: null, winKind: null, winHand: null,
          round: (g.round || 0) + 1, shown: [], withOkey: false, lastMoveAt: Date.now(), updatedAt: Date.now(), log: "Oyun başladı",
        };
        const hands = {};
        g.seats.forEach((s, i) => { if (s.bot) secret.bots[i] = d.hands[i]; else hands[s.uid] = d.hands[i]; });
        runBots(st, secret, hands);
        settle(tx, db, st, wallets);
        for (const u of humansNow) if (wallets[u]) tx.set(db.doc(`wallets/${u}`), wallets[u]);
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
      const walletUids = [...new Set([...humanUids, ...(g.paid || [])])];
      const wSnaps = await Promise.all(walletUids.map((u) => tx.get(db.doc(`wallets/${u}`))));
      const wallets = {};
      walletUids.forEach((u, i) => { wallets[u] = wSnaps[i].exists ? wSnaps[i].data() : null; });
      const st = { ...g };
      const saveW = () => { settle(tx, db, st, wallets); for (const [u, w] of Object.entries(wallets)) if (w) tx.set(db.doc(`wallets/${u}`), w); };

      // Masadan kalk (oyun sırasında): yerine bilgisayar geçer
      if (act === "leave") {
        if (mySeat < 0) return { status: 200, body: { ok: true } };
        secret.bots[mySeat] = hands[uid];
        delete hands[uid];
        const used = st.seats.filter((x) => x && x.bot).map((x) => x.name);
        st.seats[mySeat] = { uid: null, bot: true, name: BOT_NAMES.find((n) => !used.includes(n)) || "Bot" };
        st.log = "Bir oyuncu masadan kalktı, yerine bilgisayar geçti";
        runBots(st, secret, hands);
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats, uid);
        return { status: 200, body: { ok: true } };
      }

      // Uzun süre oynamayanın yerine otomatik hamle
      if (act === "poke") {
        const cur = st.seats[st.turn];
        if (cur.bot || Date.now() - (st.lastMoveAt || 0) < (st.turnSec ? st.turnSec * 1000 : IDLE_MS)) return { status: 200, body: { ok: true, idle: false } };
        autoMove(st, secret, hands, st.turn);
        runBots(st, secret, hands);
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true, idle: true } };
      }

      // Çay molası: masadaki tüm oyuncular isterse oyun 2 dakika durur (10 dakikada bir)
      if (act === "tea") {
        if (mySeat < 0) return { status: 403, body: { error: "seat" } };
        const now = Date.now();
        if ((st.pauseUntil || 0) > now) return { status: 200, body: { ok: true } };
        if (st.teaAt && now - st.teaAt < 10 * 60 * 1000) return { status: 200, body: { ok: false, error: "teacd" } };
        let votes = st.teaVoteAt && now - st.teaVoteAt < 60000 ? (st.teaVotes || []).slice() : [];
        if (!votes.includes(uid)) votes.push(uid);
        const humans = st.seats.filter((x) => x && !x.bot && x.uid).map((x) => x.uid);
        if (humans.every((u) => votes.includes(u))) {
          st.pauseUntil = now + 120000; st.teaAt = now; st.teaVotes = []; st.teaVoteAt = 0;
          st.lastMoveAt = now + 120000; st.log = "☕ Çay molası: oyun 2 dakika durdu";
        } else { st.teaVotes = votes; st.teaVoteAt = now; st.log = "☕ Çay molası istendi (" + votes.length + "/" + humans.length + ")"; }
        st.updatedAt = now;
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }

      // Açık masada oylamayla atma: hedef dışındaki oyuncuların hepsi (en az 2 kişi) oy verirse
      // oyuncu masadan çıkarılır, yerine bilgisayar geçer, bu masaya tekrar oturamaz
      if (act === "kick") {
        if (mySeat < 0 || !st.public) return { status: 403, body: { error: "seat" } };
        const t = Number(b.seat), ts = st.seats[t];
        if (!(t >= 0 && t < 4) || t === mySeat || !ts || ts.bot || !ts.uid) return { status: 400, body: { error: "target" } };
        const now = Date.now();
        const others = st.seats.filter((x, i) => x && !x.bot && x.uid && i !== t).map((x) => x.uid);
        if (others.length < 2) return { status: 200, body: { ok: false, error: "few" } };
        let k = st.kick && st.kick.seat === t && now - st.kick.at < 90000 ? { ...st.kick, votes: st.kick.votes.slice() } : { seat: t, votes: [], at: now };
        if (!k.votes.includes(uid)) k.votes.push(uid);
        if (others.every((u) => k.votes.includes(u))) {
          const out = ts.uid;
          secret.bots[t] = hands[out]; delete hands[out];
          const used = st.seats.filter((x) => x && x.bot).map((x) => x.name);
          st.seats[t] = { uid: null, bot: true, name: BOT_NAMES.find((n) => !used.includes(n)) || "Bot" };
          st.banned = [...new Set([...(st.banned || []), out])];
          st.kick = null; st.log = "🚫 Bir oyuncu oylamayla masadan çıkarıldı, yerine bilgisayar geçti";
          runBots(st, secret, hands);
          saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats, out);
        } else {
          st.kick = k; st.log = "🚫 " + (ts.name || "Bir oyuncu") + " için atma oylaması (" + k.votes.length + "/" + others.length + ")";
          saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        }
        return { status: 200, body: { ok: true } };
      }

      if (mySeat < 0) return { status: 403, body: { error: "seat" } };
      if (st.turn !== mySeat) return { status: 409, body: { error: "turn" } };
      if ((st.pauseUntil || 0) > Date.now()) return { status: 409, body: { error: "pause" } };
      const hand = hands[uid];
      const okey = O.okeyOf(st.indicator);

      // Göstergeyi göster: elinde göstergenin eşi varsa, ilk taşını atmadan önce +1 puan
      if (act === "show") {
        const twin = hand.find((t) => t !== st.indicator && !O.isFake(t) && O.colorOf(t) === O.colorOf(st.indicator) && O.numOf(t) === O.numOf(st.indicator));
        if (twin == null || (st.shown || []).includes(mySeat) || (st.discards[mySeat] || []).length) return { status: 409, body: { error: "noshow" } };
        st.shown = [...(st.shown || []), mySeat];
        st.scores = (st.scores || [0, 0, 0, 0]).slice(); st.scores[mySeat] += 1;
        st.log = "Göstergeyi gösterdi (+1 puan)";
        st.showTile = twin;
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }
      if (act === "draw") {
        if (st.phase !== "draw") return { status: 409, body: { error: "phase" } };
        const from = b.from === "left" ? "left" : "pile";
        if (from === "left") {
          const pd = st.discards[prev(mySeat)];
          if (!pd.length) return { status: 409, body: { error: "empty" } };
          hand.push(pd.pop());
          st.log = "Soldan aldı";
        } else {
          if (!secret.pile.length) { endDraw(st); saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats); return { status: 200, body: { ok: true } }; }
          hand.push(secret.pile.pop());
          st.log = "Ortadan çekti";
        }
        st.phase = "discard";
        st.lastMoveAt = Date.now();
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
        return { status: 200, body: { ok: true } };
      }

      if (act === "discard" || act === "finish") {
        if (st.phase !== "discard") return { status: 409, body: { error: "phase" } };
        const t = Number(b.tile);
        const idx = hand.indexOf(t);
        if (idx < 0) return { status: 400, body: { error: "tile" } };
        const rest0 = hand.filter((_, i) => i !== idx);
        // el bitiyorsa atılan taş otomatik olarak bitiriş sayılır
        const autoWin = false; // oyuncu bitirmek isterse taşı desteye koyar (finish); atmak her zaman serbest
        if (act === "finish" || autoWin) {
          const rest = rest0;
          const kind = autoWin || O.winKind(rest, okey);
          if (!kind) return { status: 200, body: { ok: false, error: "nowin" } };
          const firstMove = !(st.discards[mySeat] || []).length;
          hand.splice(idx, 1);
          st.discards[mySeat].push(t);
          finish(st, mySeat, kind, rest, O.valueOf(t, okey) === "W", { firstMove, okey });
          saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
          return { status: 200, body: { ok: true, win: kind } };
        }
        hand.splice(idx, 1);
        st.discards[mySeat].push(t);
        st.turn = next(mySeat);
        st.phase = "draw";
        st.lastMoveAt = Date.now();
        st.log = "Taş attı";
        runBots(st, secret, hands);
        saveW(); writeAll(tx, gref, sref, id, st, secret, hands, g.seats);
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

function finish(st, seat, kind, rest, withOkey, extra = {}) {
  st.status = "over";
  st.winner = seat;
  st.winKind = kind;
  st.winHand = rest;
  let pts = kind === "cift" ? 4 : 2;
  if (withOkey) pts *= 2;
  st.withOkey = !!withOkey;
  // Renkten bitme (bütün taşlar tek renk) ve elden bitme (ilk atışta) puanı ikiye katlar
  const vals = extra.okey ? rest.map((t) => O.valueOf(t, extra.okey)).filter((v) => v !== "W") : [];
  const color = vals.length && vals.every((v) => v.c === vals[0].c);
  if (color) pts *= 2;
  if (extra.firstMove) pts *= 2;
  st.bonus = [color ? "renkten" : "", extra.firstMove ? "elden" : ""].filter(Boolean);
  st.scores = (st.scores || [0, 0, 0, 0]).slice();
  st.scores[seat] += pts;
  st.points = pts;
  st.log = `${kind === "cift" ? "Çiftten" : "Seriden"} bitti${withOkey ? ", okey atarak" : ""}${color ? ", renkten" : ""}${extra.firstMove ? ", elden" : ""}`;
}

// El bitince jetonları dağıt, seviye ve sıralama güncelle (bir kez)
//  - İnsan kazanırsa: pot (oyuncuların ücreti + bilgisayarların kasadan ödenen ücreti) - %5 kesinti
//  - Bilgisayar kazanırsa: oyuncuların ücreti kasaya
//  - Berabere: oyuncuların ücreti kesintisiz iade
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
      // Çanak Okey: %5 kasaya + %5 çanağa; okey atarak biten çanaktakini de alır
      const toCanak = st.canak ? Math.round(total * E.RAKE) : 0;
      let canakWin = 0;
      st.canakPot = (st.canakPot || 0) + toCanak;
      if (st.canak && st.withOkey) { canakWin = st.canakPot; st.canakPot = 0; }
      const amount = total - rake - toCanak + canakWin;
      E.credit(tx, db, winnerUid, wallets[winnerUid], amount, canakWin ? "Okey kazanç + çanak" : "Okey kazanç");
      st.payout = { uid: winnerUid, amount, rake, canak: toCanak, canakWin };
      houseLog(tx, db, rake - (st.botStake || 0), { rake, botStake: st.botStake || 0 });
    } else if (w != null) {
      // bilgisayar kazandı: çanaklı masada payın bir kısmı yine çanağa gider (çanağı sadece okey atan oyuncu alır)
      const toCanak = st.canak ? Math.min(humanPot, Math.round((humanPot + (st.botStake || 0)) * E.RAKE)) : 0;
      st.canakPot = (st.canakPot || 0) + toCanak;
      st.payout = { house: true, amount: humanPot - toCanak, canak: toCanak };
      houseLog(tx, db, humanPot - toCanak, { botWin: humanPot - toCanak });
    } else {
      const seated = new Set(st.seats.filter((s) => !s.bot).map((s) => s.uid));
      for (const u of st.paid || []) if (seated.has(u) && wallets[u]) E.credit(tx, db, u, wallets[u], st.stake, "Okey iade (berabere)");
      st.payout = { refund: true, amount: st.stake };
    }
  }
  const humansAll = st.seats.filter((x) => !x.bot).map((x) => x.uid);
  for (const s of st.seats) {
    if (s.bot || !wallets[s.uid]) continue;
    const won = s.uid === winnerUid, draw = w == null;
    const delta = draw ? 0 : won ? (st.payout?.amount || 0) - (st.stake || 0) : -(st.stake || 0);
    E.afterGame(tx, db, s.uid, wallets[s.uid], { won, draw, type: "okey", stake: st.stake, delta, opp: humansAll.filter((u) => u !== s.uid), gid: st.gid || "g", round: st.round || 1, points: st.points });
  }
  st.pot = 0;
}

// Kasa hesabı: net değişim ve ayrıntılar
function houseLog(tx, db, net, parts) {
  tx.set(db.doc("house/stats"), { net: FieldValue.increment(net), rake: FieldValue.increment(parts.rake || 0), botWin: FieldValue.increment(parts.botWin || 0), botStake: FieldValue.increment(parts.botStake || 0), hands: FieldValue.increment(1) }, { merge: true });
  tx.set(db.collection("house_ledger").doc(), { net, ...parts, at: Date.now() });
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
    const ch = O.botChooseDraw(hand, top, okey, st.seats[seat].bot ? st.botSkill ?? 2 : 2);
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
  const t = O.botChooseDiscard(hand, okey, Math.random, st.seats[seat].bot ? st.botSkill ?? 2 : 2);
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
