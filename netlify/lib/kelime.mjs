// Kelimece: her gün herkese aynı 5 harfli Türkçe kelime. Cevap sadece sunucuda bilinir.
const RAW = `KALEM KİTAP ELMAS BAHÇE DENİZ GÜNEŞ ÇİÇEK SİMİT ÇORBA BÖREK LOKUM KAHVE KÖPEK ASLAN KARGA MARTI SERÇE YUNUS BALIK ORMAN NEHİR KAYIK ARABA SINIF KUZEY GÜNEY BULUT KÖPRÜ HAVLU SABUN TABAK ÇATAL BIÇAK KAŞIK DOLAP PERDE YATAK LAMBA RADYO HAVUZ BAKIR DEMİR ALTIN GÜMÜŞ ŞEKER BİBER SOĞAN ARMUT KİRAZ KAVUN LİMON ÇİLEK İNCİR NOHUT EKMEK SUCUK PASTA KEBAP DÖNER AYRAN TARLA ŞEHİR SOKAK CADDE KİLİM RESİM MÜZİK ŞARKI TÜRKÜ DAVUL ZURNA KEMAN TAVLA PİŞTİ BİLYE SEVGİ HAYAT HAYAL BAHAR GÜZEL BÜYÜK KÜÇÜK HIZLI YAVAŞ SICAK SOĞUK TATLI TUZLU BEYAZ SİYAH YEŞİL ŞAPKA ÇANTA CEKET ÇORAP KAZAK KUMSAL ÇADIR DAĞCI YOLCU BEKÇİ AŞÇI FIRIN MANAV BAKKAL KASAP TERZİ BERBER HEMŞİRE DOKTOR POLİS ASKER ÖĞRETMEN KUMRU LEYLEK KARTAL ŞAHİN TAVUK HOROZ KEÇİ KOYUN KUZU EŞEK DEVE AYICIK TİLKİ SİNEK ARILAR KELEBEK BÖCEK YILAN KAPLAN ZEBRA PAPAĞAN GÜVEN SABIR ŞÜKÜR NEFES DUMAN TOPAÇ UÇURTMA SALINCAK KAYDIRAK BEŞİK TEYZE KARDEŞ ÇAYCI ÇAYLAK OCAKLI TENCERE TAVAN DUVAR BALKON BAHÇIVAN KAPICI MERDİVEN PENCERE`;
const up = (w) => w.toLocaleUpperCase("tr-TR");
export const WORDS = [...new Set(RAW.split(/\s+/).map(up).filter((w) => [...w].length === 5))];
export const LETTERS = /^[A-ZÇĞİIÖŞÜ]{5}$/;
export const PRIZE = 5000, TRIES = 6;
export function wordOf(day) {
  // gün → kelime (karıştırılmış sıra; tahmin edilmesin diye sabit tuzla)
  let h = 2166136261;
  for (const c of "trk-" + day) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return WORDS[h % WORDS.length];
}
// 2 = doğru yer, 1 = kelimede var, 0 = yok
export function score(guess, ans) {
  const g = [...guess], a = [...ans], res = [0, 0, 0, 0, 0], left = {};
  for (let i = 0; i < 5; i++) { if (g[i] === a[i]) res[i] = 2; else left[a[i]] = (left[a[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (res[i] !== 2 && left[g[i]] > 0) { res[i] = 1; left[g[i]]--; }
  return res;
}
