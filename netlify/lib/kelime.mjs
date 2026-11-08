// Kelimece: her gün 5 ipucu sorusu, cevaplar zor kelimeler. Her soru için 3 hak.
// Tahminde harfler renklenir: 2 = doğru yerde, 1 = kelimede var, 0 = yok. Cevaplar sadece sunucuda.
export const PUZ = [
  ["Ay'ın Dünya ile Güneş arasına girmesi", "GÜNEŞTUTULMASI"],
  ["Bir şeyi olduğundan büyük gösterme", "ABARTI"],
  ["Gökyüzünde gece görülen ışıklı kuyruklu gök cismi", "KUYRUKLUYILDIZ"],
  ["Osmanlı'da padişahın fermanına basılan imza", "TUĞRA"],
  ["Ebru suyunu koyulaştıran bitki zamkı", "KİTRE"],
  ["Mimar Sinan'ın 'ustalık eserim' dediği cami", "SELİMİYE"],
  ["Karagöz'ün en yakın arkadaşı", "HACİVAT"],
  ["Türk kahvesinin pişirildiği küçük kap", "CEZVE"],
  ["Çay demlenen iki katlı kap", "ÇAYDANLIK"],
  ["Hızır ile İlyas'ın buluştuğu bahar bayramı", "HIDIRELLEZ"],
  ["Nasreddin Hoca'nın bindiği hayvan", "EŞEK"],
  ["Kaşıkla çalınan, ritim tutan Türk halk çalgısı", "KAŞIK"],
  ["Bağlamanın en küçük boyu", "CURA"],
  ["Ney üfleyen kişi", "NEYZEN"],
  ["Kubbe altında hutbe okunan basamaklı yer", "MİNBER"],
  ["Divan edebiyatında iki dizelik nazım birimi", "BEYİT"],
  ["Dört dizelik halk şiiri türü", "MANİ"],
  ["Gölge oyununda perdeye yansıtılan deri figürler", "TASVİR"],
  ["Dokumada çözgü ipliklerini geçen iplik", "ATKI"],
  ["El ile düğüm atılarak dokunan yer sergisi", "HALI"],
  ["Ahşabı oyarak süsleme sanatı", "OYMACILIK"],
  ["Bakır kapları kalaylayan usta", "KALAYCI"],
  ["Ekmeğin pişirildiği taş ya da tuğla ocak", "FIRIN"],
  ["Yufka açmakta kullanılan ince uzun çubuk", "OKLAVA"],
  ["Mantının üzerine dökülen", "YOĞURT"],
  ["Kuzey Işıkları'nın diğer adı", "AURORA"],
  ["Suyun buharlaşıp bulutlarda yoğunlaşması döngüsü", "SUDÖNGÜSÜ"],
  ["Bitkilerin güneş ışığıyla besin üretmesi", "FOTOSENTEZ"],
  ["Depremin şiddetini ölçen ölçek", "RİCHTER"],
  ["Volkandan çıkan erimiş kaya", "LAV"],
  ["Gezegenimizi saran gaz tabakası", "ATMOSFER"],
  ["Güneş'e en yakın gezegen", "MERKÜR"],
  ["Halkalarıyla ünlü gezegen", "SATÜRN"],
  ["Vücutta kanı temizleyen fasulye biçimli organ", "BÖBREK"],
  ["Pusulanın gösterdiği yön", "KUZEY"],
  ["Haritada kuzey-güney doğrultusundaki çizgiler", "MERİDYEN"],
  ["Haritada doğu-batı doğrultusundaki çizgiler", "PARALEL"],
  ["Türkiye'nin en kalabalık şehri", "İSTANBUL"],
  ["Peri bacalarıyla ünlü bölge", "KAPADOKYA"],
  ["Trabzon'daki kayalığa oyulmuş manastır", "SÜMELA"],
  ["Dünyanın bilinen en eski tapınağı (Şanlıurfa)", "GÖBEKLİTEPE"],
  ["İstanbul Boğazı'nın diğer adı", "BOĞAZİÇİ"],
  ["Ankara keçisinin diğer adı", "TİFTİKKEÇİSİ"],
  ["Tavlada rakibin pulunu vurmak", "KIRMAK"],
  ["Tavlada rakip hiç pul toplayamadan bitirmek", "MARS"],
  ["Okey'de göstergeden bir büyük taş", "OKEY"],
  ["Batak'ta oyunu yönlendiren baskın renk", "KOZ"],
  ["Satrançta şahı çıkışsız bırakmak", "MAT"],
  ["Satrançta kale ile şahın yer değiştirmesi", "ROK"],
  ["Futbolda topun kale çizgisini geçmesi", "GOL"],
  ["Güreşte yağlanarak yapılan geleneksel tür", "YAĞLIGÜREŞ"],
  ["Kırkpınar'ın düzenlendiği şehir", "EDİRNE"],
  ["Atlı yapılan Türk takım sporu", "CİRİT"],
  ["Mektup ya da paket getiren görevli", "POSTACI"],
  ["Gizli yazıyı çözme bilimi", "KRİPTOLOJİ"],
  ["Uçtan uca şifrelemede herkese açık olan anahtar", "AÇIKANAHTAR"],
  ["Bilgisayarın beyni sayılan parça (CPU)", "İŞLEMCİ"],
  ["Kamerayla yapılan telefon görüşmesi", "GÖRÜNTÜLÜARAMA"],
  ["Sabrın sonu", "SELAMET"],
  ["Atasözü: Damlaya damlaya … olur", "GÖL"],
];
export const PER = 5, TRIES = 3, PRIZE = 3000;
const up = (w) => w.toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
export const norm = up;
export const LETTERS = /^[A-ZÇĞİIÖŞÜ]{2,20}$/;
export function dayIdx(day) {
  let h = 2166136261; for (const c of "kel2-" + day) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const out = []; let x = h;
  while (out.length < PER) { x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; const i = x % PUZ.length; if (!out.includes(i)) out.push(i); }
  return out;
}
export function score(guess, ans) {
  const g = [...guess], a = [...ans], res = a.map(() => 0), left = {};
  for (let i = 0; i < a.length; i++) { if (g[i] === a[i]) res[i] = 2; else left[a[i]] = (left[a[i]] || 0) + 1; }
  for (let i = 0; i < a.length; i++) if (res[i] !== 2 && left[g[i]] > 0) { res[i] = 1; left[g[i]]--; }
  return res;
}
