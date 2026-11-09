// Tanı amaçlı: TURN ayarlarının var olup olmadığını ve Cloudflare'in yanıt verip vermediğini söyler.
// Hiçbir anahtar ya da kimlik bilgisi döndürmez.
export default async () => {
  const { CF_TURN_KEY_ID: kid, CF_TURN_API_TOKEN: tok, FIREBASE_SERVICE_ACCOUNT: sa } = process.env;
  const out = { hasKeyId: !!kid, hasToken: !!tok, hasFirebase: !!sa, cfStatus: null, turnUrls: 0 };
  if (kid && tok) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${kid}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 60 }),
      });
      out.cfStatus = r.status;
      if (r.ok) { const d = await r.json(); const l = Array.isArray(d.iceServers) ? d.iceServers : [d.iceServers]; out.turnUrls = l.flatMap((s) => [].concat(s?.urls || [])).filter((u) => /^turns?:/.test(u)).length; }
    } catch (e) { out.cfStatus = "hata: " + e.message; }
  }
  // Firebase anahtarı: hangi anahtarın kullanıldığı (kimliğin ilk 6 hanesi, gizli değil) ve veritabanına erişilebiliyor mu
  if (sa) {
    try { const j = JSON.parse(sa); out.fbKey = String(j.private_key_id || "").slice(0, 6); } catch (e) { out.fbKey = "okunamadı"; }
    try { const { admin } = await import("../lib/admin.mjs"); await admin().db.doc("config/app").get(); out.fbOk = true; } catch (e) { out.fbOk = false; out.fbErr = String(e.message || e).slice(0, 80); }
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
export const config = { path: "/api/turn-check" };
