# TR — Nerede kaldık (1 Kasım 2026)

## Yayın yeri
- Netlify ücretsiz kredisi bitti (ayda ~20 yayın). Vercel'e taşınıyor: `vercel.json` + `api/*.mjs` (Netlify fonksiyonlarını sarar).
- Vercel ortam değişkenleri: FIREBASE_SERVICE_ACCOUNT, CF_TURN_KEY_ID, CF_TURN_API_TOKEN
- Yeni alan adı Firebase Authentication > Authorized domains'e eklenmeli; APK yeni adresle yeniden üretilmeli.

## Çalışanlar
- Site: https://luminous-syrniki-b2dc9b.netlify.app (GitHub `main` → Netlify otomatik yayın)
- APK: PWABuilder ile üretildi, paket adı `com.trtr.mesaj` (imza anahtarı Harun'da, güvenli sakla)
- Firebase projesi: `trtr-f0f6d` (Frankfurt, Spark/ücretsiz plan)
- Google ile giriş, profil (ad, soyad, gizli telefon), 6 haneli TR ID
- Uçtan uca şifreli birebir sohbet, grup sohbeti, fotoğraf, sesli mesaj, durum
- Çıkış düzeltmesi, tam ekran (assetlinks)

## Yarım kalan
- [ ] Netlify'a `FIREBASE_SERVICE_ACCOUNT` ortam değişkenini ekle (Firebase → Service accounts → Generate new private key; JSON'un tamamı), sonra Trigger deploy
- [ ] Telefonda bildirim ve "Rehberden bul" denemesi
- [ ] Yeni bayraklı ikon için APK'yı PWABuilder'da yeniden üret (mevcut signing.keystore ile, yoksa yeni parmak izini assetlinks.json'a ekle)

## Aramalar
- Sesli/görüntülü arama eklendi (WebRTC, Firestore sinyal). Mobil hatlar için TURN gerekli:
  Netlify ortam değişkenleri `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` (Cloudflare Realtime TURN, aylık 1000 GB ücretsiz)

## Jeton ekonomisi (eklendi)
- Cüzdan (wallets), defter (ledger), hoş geldin 100.000, masa ücreti, seviye/XP, desenler, sıralama (lb_day, lb_month), gece ödülü (/api/cron, Vercel cron 21:01 UTC = 00:01 TR), yönetim paneli (ADMIN_CODES, varsayılan 794985)
- Vercel'de ek ortam değişkeni: CRON_SECRET (rastgele uzun bir metin)
- Ödeme: Play Store + Google Play Billing bağlanınca açılacak
- Salonlar bakiyeye göre (economy.mjs TIERS); %5 kesinti (RAKE); bilgisayar kazanırsa pot kasaya; bilgisayarların ücretini kasa öder; berabere iade. Kasa: house/stats
- Aylık ödüller şimdilik 1.000.000 / 500.000 / 200.000 (economy.mjs)
- Firestore kurallarının son hali firestore.rules dosyasında; konsola elle yapıştırılmalı

## Sıradakiler
1. Yanıtla, tepki, mesaj silme/düzenleme
2. Profil fotoğrafı, çevrimiçi/son görülme, "yazıyor…"
3. Engelleme, uygulama kilidi, sabitleme/arşiv/sessize alma
4. Kanallar, topluluk, anket, fotoğraflı durum, ortak liste, etkinlik
5. Tanıtım sitesi, yönetim paneli
6. (İsteğe bağlı) SMS ile numara doğrulama, sesli/görüntülü arama, Play Store

## Kasım 2026
- Arkadaşlık isteği: friends/{küçükUid_büyükUid}. Mesaj/arama kurallarla, oyun sunucuda arkadaşlık ister. Eski yazışmalar /api/wallet "me" ile otomatik arkadaş olur (wallet.fm).
- VIP: 30 gün 250.000 jeton (economy.VIP). badges/{uid}.vipUntil sunucu yazar. VIP desenler vip:true. profile_views/{bakılan}/v/{bakan}; listeyi /api/wallet "views" verir (VIP değilse sadece sayı).
- Bilardo (8 top): netlify/lib/pool.mjs (ortak fizik, kurallar, bot), /api/pool. İstemci lastShots'u aynı fizikle tekrar oynatır.
