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

## Notlar
- Hileli dağıtım (para yükleyenin kazanma oranını düşürme) yapılmayacak — reddedildi.
- Vercel Hobby ticari kullanıma izin vermiyor; satışa başlayınca Pro gerekir.
- Gerçek para ile jeton satışı Play Store'da Google Play Faturalandırma ile olacak.
