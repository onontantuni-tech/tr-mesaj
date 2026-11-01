// Arama için TURN sunucu bilgisi verir (mobil hatlarda iki telefonun birbirini bulabilmesi için).
// Cloudflare Realtime TURN: CF_TURN_KEY_ID + CF_TURN_API_TOKEN ortam değişkenleri.
// Yedek olarak Metered Open Relay: METERED_DOMAIN + METERED_API_KEY.
// Hiçbiri yoksa boş liste döner, arama sadece STUN ile denenir.
import { json, requireUser } from "../lib/admin.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const uid = await requireUser(req);
  if (!uid) return json(401, { error: "auth" });
  try {
    const { CF_TURN_KEY_ID: kid, CF_TURN_API_TOKEN: tok, METERED_DOMAIN: md, METERED_API_KEY: mk } = process.env;
    if (kid && tok) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${kid}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 6 * 3600 }),
      });
      if (r.ok) {
        const d = await r.json();
        const list = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
        return json(200, { iceServers: list });
      }
    }
    if (md && mk) {
      const r = await fetch(`https://${md}/api/v1/turn/credentials?apiKey=${encodeURIComponent(mk)}`);
      if (r.ok) return json(200, { iceServers: await r.json() });
    }
  } catch {}
  return json(200, { iceServers: [] });
};

export const config = { path: "/api/turn" };
