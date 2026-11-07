// Kötü söz filtresi (istemci ve sunucu ortak). Türkçe küçük harfe çevirir, leet yazımları ve
// tekrar eden harfleri sadeleştirir, sonra kelime başlarında kök arar.
// Sadece adlar, grup adları, durumlar ve açık masa sohbeti için. Uçtan uca şifreli özel mesajlara dokunmaz.

// Kelime başında geçerse yakalanan kökler (Türkçe harfler sadeleştirilerek karşılaştırılır)
const ROOTS = [
  "orospu", "orosbu", "oruspu", "siktir", "sikerim", "sikeyim", "sikiyim", "siktim", "sikimi", "sikik",
  "yarrak", "dalyarak", "amcik", "aminakoy", "aminakoyim", "aminako", "aminagoy",
  "pezevenk", "pezeveng", "kahpe", "gavat", "ibne", "yavsak", "serefsiz", "kaltak",
  "gotveren", "gotlek", "godos", "surtuk", "kevase", "kodumun", "kodugum",
];
// Tam kelime olarak ve Türkçe harfiyle yazıldığında yakalananlar (sadeleştirince masum kelimelere dönüşenler:
// "göt"→"got", "şık"/"sık"→"sik", "piç"→"pic")
const RAW_WHOLE = ["göt", "götü", "götün", "götünü", "götüne", "oç", "piç", "piçler", "sik", "sikim", "amk", "aq", "amq", "puşt", "yarak"];

const TR = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u" };
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

const low = (w) => w.toLocaleLowerCase("tr-TR").replace(/[0134579@$!]/g, (c) => LEET[c] || c).replace(/[^a-zçğıöşüâîû]/g, "").replace(/(.)\1+/g, "$1");
const norm = (w) => low(w).replace(/[çğıöşüâîû]/g, (c) => TR[c]);
const NROOTS = ROOTS.map(norm);
const RAW = new Set(RAW_WHOLE.map(low));

function badWord(word) {
  const l = low(word);
  if (l.length < 2) return false;
  if (RAW.has(l)) return true;
  const n = norm(word);
  return NROOTS.some((r) => n.startsWith(r));
}

// Harfler arasına boşluk/nokta konarak yazılmış hâlleri de yakala: "s.i.k.t.i.r"
const joined = (t) => t.replace(/(?<=(?:^|[\s._\-*])\p{L})[\s._\-*]+(?=\p{L}(?:$|[\s._\-*]))/gu, "");
const words = (s) => s.split(/[^\p{L}\p{N}@$!]+/u).filter(Boolean);

export function hasBad(text) {
  const t = String(text || "");
  return words(t).some(badWord) || words(joined(t)).some(badWord);
}

const mask = (t) => t.replace(/[\p{L}\p{N}@$!]+/gu, (w) => (badWord(w) ? "*".repeat(Math.min(w.length, 6)) : w));
export function clean(text) {
  let r = mask(String(text || ""));
  if (hasBad(r)) r = mask(joined(r));
  return r;
}
