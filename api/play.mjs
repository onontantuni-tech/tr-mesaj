// Vercel fonksiyonu: bütün oyun sunucuları tek fonksiyonda (Hobby planı 12 fonksiyon sınırı).
// /api/game, /api/pool, /api/pisti, /api/tavla adresleri vercel.json'da buraya yönlendirilir (?k=tür).
import okey from "../netlify/functions/game.mjs";
import pool from "../netlify/functions/pool.mjs";
import pisti from "../netlify/functions/pisti.mjs";
import tavla from "../netlify/functions/tavla.mjs";
import batak from "../netlify/functions/batak.mjs";

const H = { okey, game: okey, pool, pisti, tavla, batak };

function pick(request) {
  try {
    const u = new URL(request.url);
    const k = u.searchParams.get("k") || u.pathname.split("/").filter(Boolean).pop();
    return H[k] || null;
  } catch { return null; }
}
const run = (request) => {
  const h = pick(request);
  if (!h) return new Response(JSON.stringify({ error: "kind" }), { status: 404, headers: { "content-type": "application/json" } });
  return h(request);
};
export const POST = run;
export const GET = run;
