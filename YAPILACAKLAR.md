# TR — Durum ve yapılacaklar

Son güncelleme: 6 Kasım 2026

## Bitti (GitHub: onontantuni-tech/tr-mesaj, main)
- Mesajlaşma: Google girişi, 6 haneli TR ID, uçtan uca şifreli birebir ve grup sohbetleri, fotoğraf, sesli mesaj, durum, bildirimler, rehberden bul
- Sesli ve görüntülü arama (WebRTC + Cloudflare TURN)
- Okey (4 kişilik, bilgisayar rakipler)
- Jeton ekonomisi: hoş geldin hediyesi 100.000, bakiyeye göre 5 salon, %5 kesinti, bilgisayar kazanırsa pot kasaya, günlük ve aylık sıralama ödülleri, masa ve ıstaka desenleri, seviye, yönetim paneli
- Arkadaşlık isteği (herkes için): kabul edilmeden mesaj, arama ve oyun yok
- VIP: 30 gün 250.000 jeton (onaylandı), taç rozeti, VIP desenler, "Profilimi kimler gördü"
- Bilardo (8 top), 2 kişilik, bilgisayar rakip
- Rakamlar onaylandı: VIP 250.000 · aylık ödüller 1.000.000 / 500.000 / 200.000

## Kullanıcının yapacakları (bekleyen)
1. Yeni Firestore kurallarını (firestore-kurallari.txt) Firebase Konsolu → Firestore → Kurallar sekmesine yapıştırıp Yayınla
2. Vercel kurulumu: GitHub ile giriş → tr-mesaj'ı içe aktar → ortam değişkenleri (FIREBASE_SERVICE_ACCOUNT, CF_TURN_KEY_ID, CF_TURN_API_TOKEN, CRON_SECRET) → Deploy → adresi Claude'a gönder
3. Sonra Claude: Vercel adresini Firebase Auth yetkili alan adlarına ekler, APK'yı yeni adres ve bayrak simgesiyle yeniden üretir, assetlinks parmak izini günceller
4. Mobil veriyle arama denemesinin sonucunu bildir

## Sıradaki işler (kullanıcı bilgisayar başına geçince başlanacak)

### 1. Herkese açık oyunlar
- Oyun sekmesinde "Oyna" butonu: herkese açık masalar (lobi). Masa listesi: oyun türü, salon / masa ücreti, dolu koltuk sayısı. "Hızlı otur" ile uygun masaya otur ya da yeni açık masa kur.
- Açık masada boş koltuk belli bir sürede (ör. 20 sn) dolmazsa bilgisayar oturur.
- Arkadaşlarla oynamak isteğe bağlı: sohbetteki 🎮 butonu (mevcut özel masa) aynen kalır, ayrıca "Arkadaşını davet et" seçeneği.
- Teknik: games belgesinde public:true, members kısıtı yerine okuma kuralı "public ise giriş yapan herkes" olacak. Açık masada sohbet/şifreli içerik yok. Okey ve bilardo ikisi de.

### 2. Sadakat: günlük giriş hediyesi
- Her gün ilk girişte o günün hediyesi verilir (Türkiye saatiyle gün).
- 30 günlük takvim; 30. günden sonra 1. güne döner ve hediyeler aynen devam eder.
- Önerilen takvim (onaya sunulacak): 1–6. günler 5.000 → 20.000 arası artarak, 7. gün 50.000, 14. gün 75.000, 21. gün 100.000, 30. gün 250.000 + kısa süreli VIP denemesi (isteğe bağlı).
- KARAR: bir gün girilmezse seri baştan (1. gün) başlar.
- Teknik: /api/wallet "daily" eylemi, wallet.loginDay ve wallet.streak; 30 kutulu takvim ekranı.

### 3. Arkadaşını çağır (davet)
- Yeni kullanıcı kayıtta davet edenin TR ID'sini yazar (veya davet bağlantısıyla gelir: /?ref=482913).
- Davet edene 100.000 jeton hediye. (Davet edilen zaten 100.000 hoş geldin hediyesi alıyor.)
- Kötüye kullanıma karşı: her yeni hesap sadece bir kez davetli sayılır; telefon numarası doğrulanmış ve profili tamamlanmış olmalı; kendini davet edemez; ödül, davet edilen ilk oyununu bitirince verilir (öneri; kullanıcı itiraz etmedi).
- Davet eden ile davet edilen otomatik arkadaş olur.

## Onaylanan ek özellikler ("hepsi olsun" — 6 Kasım 2026)
- Günlük çark (her gün bir ücretsiz çevirme)
- Görevler: "bugün 3 el oyna", "1 kez kazan" → jeton ve XP
- Hediye gönderme: sohbette arkadaşa sanal hediye (çay, gül, taç) — jetonla alınır, jeton transferi değil
- Turnuvalar: hafta sonu 16 kişilik eleme, giriş ücreti, büyük ödül
- Kulüpler / kahvehaneler: grup olarak sıralama
- Başarımlar ve rozetler (100 galibiyet, ilk okey bitirme…)
- Masada hazır mesajlar ve emojiler (😀 "Hadi!", "İyi oyun")
- Profil çerçeveleri (VIP'e özel ve jetonla)
- 101 Okey, Pişti, Batak, King, Tavla (zaten planda)
- Mesaj tarafı: mesajı yanıtla / ilet / sil, sohbet sabitleme, kaybolan mesajlar, grup görüntülü arama

## Onaylanan ek özellikler — 2. liste ("hepsi", 6 Kasım 2026)
1. Haftalık lig (bronz/gümüş/altın/elmas, yüksel-düş, lig ödülleri)
2. Saatlik bedava jeton kutusu (4 saatte bir)
3. Jeton bitince günde bir kez 10.000 destek
4. Rövanş butonu
5. İzleyici modu
6. Masada sesli sohbet
7. Ses efektleri ve titreşim
8. Oyun geçmişi ve istatistikler
9. Mevsimlik etkinlikler (Ramazan, bayram, yılbaşı)
10. Aylık sezon kartı (ücretsiz + VIP yolu)
11. Eşli Okey (2'ye 2)
12. Eşli Batak
13. Satranç ve dama
14. Türkçe kelime oyunu
15. Mesajlara emoji tepkisi
16. Çevrimiçi ve "yazıyor…" göstergesi
17. Son görülme (gizlenebilir)
18. Engelle ve şikâyet et (Play Store için gerekli — öncelikli)
19. Konum paylaşma
20. Dosya/belge gönderme
21. TR çıkartma paketi
22. Sohbet duvar kâğıdı
23. Kanallar
24. Mesaj zamanlama
25. Şifreli sohbet yedekleme
26. Çoklu cihaz
27. Yönetim paneline grafikler
28. Toplu duyuru bildirimi
29. İndirimli jeton kampanyaları
30. İlk yüklemeye 2 kat jeton
31. Reklam izle jeton kazan
32. Kötü söz filtresi ve şikâyet takibi (açık masalar için gerekli — öncelikli)

## Onaylanan ek özellikler — 3. liste (6 Kasım 2026; 58 ve 61 sonraya bırakıldı)
33. Hızlı Okey (kısa süreli eller)
34. Batak çeşitleri (Koz, İhaleli, Gömmeli)
35. Eşli ve katlamalı 101
36. Kuru (Sevgiliye) Pişti
37. Tombala (özel günlerde toplu, büyük ödüllü)
38. Bilardo 9 top ve 3 bant
39. Antrenman masası (jetonsuz, bilgisayara karşı)
40. Resimli oyun öğreticileri
41. Ana sayfada "Günün ödülü" kutusu ve geri sayım
42. Seri bonusu (3 el üst üste kazanana ek jeton)
43. Profil sayfası (kapak, hakkımda, en sevdiği oyun, rozetler)
44. Profil fotoğrafı yükleme
45. Takip etme
46. Ayrıntılı bildirim ayarları
47. Grup anketleri
48. Grup yönetici ayarları (sadece yöneticiler yazsın, davet bağlantısı)
49. Sohbet içinde mesaj arama
50. Sesli mesajı yazıya çevirme
51. Fotoğrafa çizim/yazı ekleme
52. Tek seferlik görüntülenen fotoğraf
53. Sohbet kilidi (parmak izi / PIN)
54. Uygulama kilidi
55. Kullanım şartları ve gizlilik politikası (Play Store için zorunlu)
56. Hesap silme (Play Store için zorunlu)
57. 18 yaş onayı (jetonlu oyunlar)
59. Destek / iletişim formu
60. Dil seçenekleri: İngilizce, Almanca, Arapça
62. Hızlı açılış ve düşük internet modu

Sonraya bırakılanlar: 58 Sorumlu oyun (harcama limiti, süre hatırlatıcı), 61 iPhone / App Store sürümü.

## Onaylanan ek özellikler — 4. liste (6 Kasım 2026; 87 sonraya bırakıldı)
63. Kahvehane odası (sanal salon, masalar yan yana, boş sandalyeye otur)
64. Avatar ve kıyafet (şapka, gözlük, bıyık…)
65. Masada yazılı sohbet balonu
66. Masaya çay ısmarlama (herkes görür)
67. Ünvanlar ("Okey Ağası", "Bilardo Ustası")
68. Haftanın oyuncusu
69. Rakip değerlendirme (👍/👎, kötü davranan az eşleşir)
70. Açık masada seviye dengeli eşleşme
71. Bağlantı kopunca masaya geri dönme
72. Şehir sıralaması
73. Takım (kulüp) ligleri
74. Arkadaş önerisi (ortak arkadaş)
75. Doğum günü hatırlatma ve hediye jeton
76. Bayram tebrik kartları
77. Duruma müzik ve fotoğraf
78. Yuvarlak video mesaj
79. Görüntülü aramada ekran paylaşımı
80. Arama kaydı (karşı tarafa bildirimli)
81. Kaydedilen mesajlar (kendine not)
82. Toplu mesaj listesi
83. Otomatik yenilenen VIP aboneliği
84. Reklamsız paket
85. Mağazada günün fırsatı
86. Hediye kodu / kartı
88. Moderatör rolü
89. Şüpheli hesap ve jeton aktarma hilesi tespiti
90. Bakım modu duyurusu

Sonraya bırakılan: 87 Bayi / yetkili satıcı sistemi (yasal danışma gerekebilir).

## Onaylanan ek özellikler — 5. liste (6 Kasım 2026; 94, 105, 106 istenmedi)
91. Okey kural seçenekleri (çifte git, renk okey)
92. Masa kuralı seçenekleri (süre, puan sınırı, el sayısı)
93. Bitmiş oyunu tekrar izleme
95. Günlük bulmaca (küçük ödüllü)
96. Mini oyunlar: langırt, dart, mini golf
97. Yakınımdakiler (isteğe bağlı, kapalı başlar, açık izin — KVKK)
98. Grup içi turnuva
99. Aile grubu / çocuk ayarı (ek yasal kurallar)
100. Hatıra albümü (büyük eller)
101. Mesaj çevirisi
102. Sesli mesaj hızı (1,5x / 2x)
103. Bağlantı önizlemesi
104. Mesaj düzenleme (15 dk)
107. İki adımlı doğrulama (PIN)
108. Oturum listesi ve uzaktan çıkış
109. Güvenlik kodu karşılaştırma (QR)
110. Tanıtım web sayfası
111. Sosyal medyada paylaşım kartı
112. Geri bildirim ve "sıradaki oyun" anketi
113. Kullanım istatistikleri

İstenmeyenler: 94 Yapay zekâ ipucu, 105 İşletme karşılama mesajı, 106 İşletme hesabı.

## Onaylanan ek özellikler — 6. liste (6 Kasım 2026; 119 ve 120 istenmedi)
114. Çanak Okey — her elden %5 kasaya + %5 çanağa birikir; okey atan çanaktaki jetonları alır (18 yaş onayı arkasında)
115. Tavla çeşitleri: Mahbusa, Gülbahar
116. Kızma Birader
117. Domino
118. Canlı bilgi yarışması (18 yaş onayı arkasında)
121. Sohbet içinde mesaj sabitleme
122. Yıldızlı mesajlar
123. Sohbet arşivleme
124. Sessize alma (8 saat / 1 hafta / her zaman)
125. Okundu bilgisini kapatma
126. Grupta @bahsetme
127. Topluluklar
128. QR kod ile arkadaş ekleme
129. Sohbeti dışa aktarma
130. Kullanıcı adı (@harun)
131. Yazı boyutu ayarı
132. Erişilebilirlik (ekran okuyucu)
133. Veri ve depolama ayarı
134. Bildirimden hızlı yanıt
135. Ana ekran kısayolları
136. Fenomen / ortaklık kodu
137. Etkinlik takvimi
138. Geri dönen kullanıcıya hediye ("Seni özledik")

İstenmeyenler: 119 Masa müziği/ortam sesi, 120 Kahve falı.

## Onaylanan ek özellikler — 7. liste ("hepsi", 6 Kasım 2026)
139. Okey'de göstergeyi gösterme bonusu
140. Bilardoda falso (alt/üst/yan vuruş)
141. Masa davet kodu (4 haneli)
142. Çay molası (herkes onaylarsa 2 dk durur)
143. Kaybedene teselli XP'si
144. Arkadaş aktivitesi ("Ayşe Okey oynuyor, katıl")
145. Grup sesli sohbet odası
146. Arkadaşlık yıldönümü kartı
147. Kişiye özel bildirim sesi
148. Albüm olarak fotoğraf gönderme (10'a kadar)
149. Orijinal kalitede fotoğraf
150. Görüntülü aramada arka plan bulanıklaştırma ve filtreler
151. Arama sırasında küçük pencere
152. Cevapsız arama için hazır mesaj
153. Kasa raporu (günlük/haftalık/aylık, Excel)
154. Yönetici iç notları
155. Hesap askıya alma ve yasaklama (öncelikli)
156. Olağan dışı jeton hareketi alarmı

## Onaylanan ek özellikler — 8. liste (6 Kasım 2026; 169 istenmedi)
157. Günlük meydan okuma
158. Koleksiyon albümü
159. Usta-çırak
160. Okey taş desenleri (fildişi, mermer, sedef)
161. Bilardo top setleri (klasik, neon, altın)
162. Elden bitme ödülü
163. Grup etkinliği (katılım + hatırlatma)
164. Mesaj hatırlatıcı
165. Grupta ortak liste
166. Sesli mesajı göndermeden dinleme
167. Sesli mesajda gürültü azaltma
168. Gizli sohbette ekran görüntüsü engeli (Android)
170. Gizlilik ayarları (fotoğraf/durum/son görülme: herkes/arkadaşlar/kimse)
171. Otomatik hata raporlama
172. Gece otomatik veritabanı yedeği
173. "Yeni sürüm var" bildirimi
174. Sunucu durumu sayfası
175. Play Store mağaza sayfası hazırlığı
176. Uygun anda puan isteme

İstenmeyen: 169 Telefon numarası değiştirme.

## Önerilen öncelik sırası
1. Vercel ve Play Store'a çıkış
2. Zorunlular: 18, 32, 55, 56, 57, 155
3. Açık oyunlar, sadakat, davet
4. Diğerleri

## Notlar
- Hileli dağıtım (para yükleyenin kazanma oranını düşürme) yapılmayacak — reddedildi.
- Vercel Hobby ticari kullanıma izin vermiyor; satışa başlayınca Pro gerekir.
- Gerçek para ile jeton satışı Play Store'da Google Play Faturalandırma ile olacak.
