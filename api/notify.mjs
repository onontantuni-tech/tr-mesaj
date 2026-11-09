// Vercel fonksiyonu: Netlify'daki aynı kodu çalıştırır.
import handler from "../netlify/functions/notify.mjs";
export const POST = (request) => handler(request);
export const GET = (request) => handler(request);
export const maxDuration = 20;
