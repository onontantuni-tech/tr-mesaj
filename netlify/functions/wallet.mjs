// Cüzdan: bakiye, seviye, desenler. Hoş geldin hediyesi ilk girişte bir kez verilir.
import { admin, json, requireUser } from "../lib/admin.mjs";
import * as E from "../lib/economy.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  let b;
  try { b = await req.json(); } catch { b = {}; }
  const { db } = admin();
  const act = String(b?.action || "me");
  const ref = db.doc(`wallets/${uid}`);

  try {
    const res = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let w = s.exists ? s.data() : null;
      let welcomed = false;
      if (!w) {
        w = E.newWallet();
        tx.set(db.collection("ledger").doc(), { uid, delta: E.WELCOME_BONUS, reason: "Hoş geldin hediyesi", by: "system", at: Date.now(), after: w.balance });
        welcomed = true;
      }

      if (act === "buySkin" || act === "equip") {
        const kind = b.kind === "rack" ? "rack" : "table";
        const item = E.SKINS[kind].find((x) => x.id === b.id);
        if (!item) return { status: 400, body: { error: "item" } };
        w.owned = w.owned || { table: ["yesil"], rack: ["ceviz"] };
        w.owned[kind] = w.owned[kind] || [];
        if (act === "buySkin" && !w.owned[kind].includes(item.id)) {
          if ((w.balance || 0) < item.price) return { status: 402, body: { error: "balance" } };
          E.credit(tx, db, uid, w, -item.price, `Desen: ${item.name}`);
          w.owned[kind].push(item.id);
        }
        if (!w.owned[kind].includes(item.id)) return { status: 403, body: { error: "notowned" } };
        w.skin = { ...(w.skin || {}), [kind]: item.id };
      }

      tx.set(ref, w);
      return { status: 200, body: { wallet: view(w), welcomed } };
    });
    return json(res.status, res.body);
  } catch (e) {
    return json(500, { error: "server" });
  }
};

function view(w) {
  const lv = E.levelFromXp(w.xp || 0);
  return {
    balance: w.balance || 0, xp: w.xp || 0, level: lv.level, levelCur: lv.cur, levelNext: lv.next,
    wins: w.wins || 0, games: w.games || 0, owned: w.owned, skin: w.skin,
    catalog: { skins: E.SKINS, packages: E.PACKAGES, tiers: E.TIERS, rake: E.RAKE, daily: E.DAILY_PRIZES, monthly: E.MONTHLY_PRIZES },
  };
}

export const config = { path: "/api/wallet" };
