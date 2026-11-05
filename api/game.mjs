// Vercel fonksiyonu: Netlify'daki aynı kodu çalıştırır.
import handler from "../netlify/functions/game.mjs";
export const POST = (request) => handler(request);
export const GET = (request) => handler(request);
