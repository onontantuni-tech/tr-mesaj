# TR — Devir notu (Claude Code için)

Son güncelleme: 10 Kasım 2026 · son commit `37d1a69` · yayındaki sürüm **tr-v48** (`public/sw.js` içindeki `C`)

Kullanıcıyla **her zaman Türkçe** konuş. Kullanıcı teknik değil; kısa, net, adım adım anlat.

---

## 1. Ürün özeti

**TR**: kırmızı-beyaz, Türk bayrağı simgeli, WhatsApp benzeri mesajlaşma + Türk oyunları + jeton ekonomisi. PWA, Android'e TWA (APK) olarak paketleniyor; hedef Play Store.

- Mesajlaşma: Google girişi, 6 haneli **TR ID**, uçtan uca şifreli birebir/grup sohbet, fotoğraf, sesli mesaj, durum, anket, etkinlik, liste, yıldızlı/sabit/arşiv/sessiz, toplu seçme, arkadaş grupları, QR, kullanıcı adı, PIN kilidi.
- Arama: WebRTC sesli/görüntülü, Cloudflare TURN.
- Oyunlar (hepsi sunucu yetkili, gizli eller sunucuda): **Okey, Çanak Okey, Bilardo (8 top, falso), Pişti, Tavla, Batak, Kızma Birader, Domino**, ayrıca Kelimece ve Bilgi yarışması (günlük).
- Ekonomi: jeton, VIP, günlük hediye/çark/sandık/görev, lig, turnuva, kulüp, şehir sıralaması, davet, cashback, hediye kodu, yönetim paneli.

## 2. Altyapı

| Parça | Değer |
|---|---|
| Kod | GitHub `onontantuni-tech/tr-mesaj`, dal `main` (push = otomatik yayın) |
| Yayın | Vercel: **https://tr-mesaj.vercel.app** (takım `onontantuni-8024`, proje `tr-mesaj`) |
| Firebase | proje `trtr-f0f6d` (Google hesabı telekomnetharun, konsol `/u/1/`), Firestore europe-west3, Auth (Google), FCM |
| Eski site | luminous-syrniki-b2dc9b.netlify.app — **ölü**, kullanma (kredisi bitti, eski Firebase anahtarı silindi) |
| Android | paket `com.trtr.mesaj`, PWABuilder/Bubblewrap TWA. İmza paketi kullanıcıda: `İndirilenler\TR-Mesaj-GooglePlay-paketi.zip` (keystore + şifreler + .aab + .apk) |
| assetlinks | `public/assetlinks.json` → `/.well-known/assetlinks.json` (vercel.json rewrite). Parmak izleri: `3E:3C:59:…:B7:BA` (yeni), `A5:B5:60:…:00:DD` (eski) |

### Vercel ortam değişkenleri
`FIREBASE_SERVICE_ACCOUNT` (10 Kasım'da yenilendi, anahtar kimliği `986996…`; eskiler silindi), `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, `CRON_SECRET`. İsteğe bağlı: `ADMIN_CODES` (virgüllü TR ID).

Kontrol adresi (gizli bilgi döndürmez): `https://tr-mesaj.vercel.app/api/turn-check` → `fbKey`, `fbOk`, `cfStatus`, `turnUrls`.

### Kod yapısı
- `src/app.js` (~3400 satır): bütün istemci. esbuild ile `public/app.js`'e paketlenir. **Commit'ten önce `npm run build`.**
- `public/index.html`: bütün HTML + CSS.
- `public/sw.js`: service worker. Önbellek önce, arka planda yenile. Push bildirimleri. **Her yayında `const C = "tr-vNN"` bir artır.**
- `netlify/functions/*.mjs`: sunucu kodu (adı Netlify ama Vercel'de çalışıyor). `api/*.mjs` bunları sarar.
  - Vercel Hobby **12 fonksiyon sınırı**: şu an 9. Bütün oyunlar `api/play.mjs` içinden `?k=` ile dağıtılır. `vercel.json` rewrite: `/api/game|pool|pisti|tavla|batak|kizma|domino → /api/play?k=…`. Yeni oyun eklerken buraya ekle, yeni fonksiyon dosyası açma.
- `netlify/lib/*.mjs`: ortak mantık (okey, pool, pisti, tavla, batak, kizma, domino, economy, kelime, quiz, filter, moderation). İstemci de import eder.
- `firestore.rules`: kurallar. Son yayınlanan sürüm kayıttaki son hâliyle aynı. Değiştirirsen Firebase Konsolu → Firestore → Kurallar'a yapıştırıp Yayınla.
- Cron: `vercel.json` içinde `1 21 * * *` (TR 00:01). Günlük/aylık ödüller, lig, turnuva, davet şampiyonu, **şehir şampiyonu** (ayın 1–5'i, 100.000 jeton, parçalı ödeme), yarım oyun iadesi.

### Firestore'un önemli kısıtları
- **İç içe dizi saklanamaz**: eller `{0:[..],1:[..]}` biçiminde map.
- Transaction içinde yazdıktan sonra okuma yok; okumaları önce yap.
- Gizli eller: `games/{id}/hands/{uid}` (sadece sahibi okur) + `gsecret/{id}` (istemciye kapalı).

### Test ortamı (repoda: `test/harness/`)
- `admin-stub.mjs`: bellek içi Firestore/Auth taklidi (`where` için `==, >=, >, <, <=, array-contains` destekler).
- Sunucu fonksiyonunu stub ile çalıştırmak:
  `sed -e 's#"../lib/admin.mjs"#"./admin-stub.mjs"#' -e 's#"../lib/#"<repo>/netlify/lib/#' netlify/functions/X.mjs > test/harness/X.mjs`
- İstemci test paketi:
  `npx esbuild src/app.js --bundle --format=iife --target=es2020 --alias:firebase/app=./test/mock-app.js --alias:firebase/auth=./test/mock-auth.js --alias:firebase/firestore=./test/mock-fs.js --alias:firebase/messaging=./test/mock-messaging.js --outfile=/tmp/tpub/app.js`, sonra `public/index.html`'i `/tmp/tpub/`'a kopyala, `python3 -m http.server 8098 -d /tmp/tpub`.
- Playwright senaryoları: `uiok` (okey), `uip` (pişti), `uidm` (domino), `uit` (tavla), `uikz` (kızma), `uibk` (batak), `pooltest`, `run` (okey sunucu), `match` (çok elli maç), `cnk` (çanak). Yolları (`/tmp/gt`, `/home/claude/...`) kendi ortamına göre düzelt.
- Birim testi: `node --test test/okey.test.mjs`.

### Commit kuralları
`git -c user.name=onontantuni-tech -c user.email=onontantuni@gmail.com commit` + Co-Authored-By satırları. Push: `git push origin main` → ~90 sn sonra canlı (sw.js'deki sürümle doğrula).

## 3. Kararlar (kullanıcı onaylı — değiştirme)

- **Bilgisayar hile yapmaz** (eli görmez, dağıtım rastgele). Kullanıcı "robotlar zorlaşsın" dedi; hile değil, **beceri** artırıldı. Hileli dağıtım reddedildi.
- Jetonlu masada bilgisayar hep **usta (skill 3)**; ücretsiz masada oyuncu seviyesine göre (`economy.botSkillFor`).
- **Bilgisayar masaya para koymaz.** Oyuncu bilgisayarları yenerse kendi ücreti + **%25 ödül** (`BOT_BONUS`) − %5 kesinti alır. Bilgisayar kazanırsa ücret kasaya.
- Masa kesintisi %5. **Çanak Okey:** her elde %5 çanağa (bilgisayar kazansa da). Çanağı **sadece okey atarak biten oyuncu** alır. Ayrı bölüm: Oyun sekmesi → 🍯 Çanak Okey.
- Okey'de el bitince otomatik bitirme yok. Bitirmek için taşı **ortadaki desteye** kaydırır (okeyle bitirme ×2). Atmak her zaman serbest. Istakadaki okey otomatik **ters** görünür.
- Pişti ve Domino: masa kurarken **1–5 el** seçilir, puan toplanır.
- VIP: 499 TL, 30 gün, 300.000 jeton (günde 10.000). Akşam turnuvası girişi 100.000. Cashback: 100k → %1, 1M → %1, 10M → %5.
- Şehir **bir kez** seçilir, değiştirilemez. Ayın birinci şehrinde kayıtlı herkese 100.000.
- Yönetici TR ID'leri: **794985** (kullanıcının hesabı) ve **423816** (Claude ekledi; kullanıcıya soruldu, cevap bekleniyor — onun değilse `netlify/functions/admin.mjs` içinden kaldır). Moderatörler `mods/{uid}`.
- Destek e-postası: farukplaystore10@gmail.com.
- İstenmeyenler: 94, 105, 106, 119, 120, 169. Sonraya: 58 (sorumlu oyun), 61 (iPhone), 87 (bayi).

## 4. Güvenlik kuralları

- **Asla** anahtar, token, şifre ya da özel anahtarı bir alana kendin yazma veya kodla/commit'le. Kullanıcı yapıştırır.
- Silme, yayınlama, ödeme gibi geri alınamaz işlerde önce kullanıcıdan açık onay al.
- `İndirilenler`'de eski, silinmiş bir Firebase anahtar dosyası (`…9219bc3027.json`) duruyor; işe yaramaz, kullanıcıya silmesi söylendi.

## 5. Bekleyen işler

### A. Kullanıcıyla birlikte (öncelikli)
1. **Cloudflare TURN anahtarını yenile.** Eski token sohbette açığa çıktı. Cloudflare girişi kullanıcıda (panelde giriş ekranında kaldı). Yeni anahtar → kullanıcı Vercel'e yapıştırır → `/api/turn-check` `cfStatus:201` → eskisini sil (onayla).
2. **Yeni APK'yı telefona kur.** Eski uygulamayı sil, `TR-Mesaj.apk`'yı kur. Adres çubuğu görünürse assetlinks kontrolü.
3. **Play Console'a yükleme.** `.aab` dosyası. Google Play App Signing açılınca Play'in imza parmak izini `public/assetlinks.json`'a ekle.
4. **Google Play Faturalandırma.** Jeton/VIP satın alma henüz kapalı (`/api/wallet buyVip` → 402). TWA için Digital Goods API + Play Billing.
5. **Mobil veriyle arama testi.**

### B. Şimdi yapılacak büyük iş: **Android'de gerçek gelen arama ekranı**
Sorun: uygulama kapalıyken arama bildirimi web push ile Chrome üzerinden geliyor, telefon pil tasarrufunda düşürüyor. Kullanıcı native çözüm istedi.

Plan (TWA projesine native parça eklemek, web uygulaması aynen kalır):
1. Bubblewrap/PWABuilder Android projesini repo içine al (ör. `android/`). Paket `com.trtr.mesaj`, mevcut imza (keystore kullanıcıda).
2. Firebase Android SDK + `google-services.json` (Firebase konsolundan Android uygulaması ekle, paket `com.trtr.mesaj`, SHA-1/256 ekle; dosyayı kullanıcı indirir).
3. `FirebaseMessagingService`: `kind=call` veri mesajı gelince **CallStyle bildirim + full-screen intent** → `IncomingCallActivity` (kilit ekranında açılır, zil sesi + titreşim, "Aç / Reddet"). `kind=missed` → normal bildirim. Arama bitince (`calls/{id}.state` değişince) ekranı kapat.
   - İzinler: `POST_NOTIFICATIONS`, `USE_FULL_SCREEN_INTENT`, `VIBRATE`, `WAKE_LOCK`. Android 14'te tam ekran izni için Play Console beyan formu: "arama uygulaması".
4. **Aç** → TWA'yı `https://tr-mesaj.vercel.app/?call=<id>&c=<uid>` ile başlat (web tarafı bu parametreyle aramayı zaten açıyor). **Reddet** → `/api/notify` benzeri yeni bir uç (`/api/account` içine eylem ekle, 12 fonksiyon sınırı) ile `calls/{id}.state=declined`. Kimlik doğrulama: native tarafta Firebase ID token yok. Çözüm: aramaya özel tek kullanımlık `declineKey`'i push verisine koy, sunucu bunu doğrulasın.
5. **Native FCM token kaydı:** TWA ilk açılışta `?ntok=<token>` ile başlat. Web tarafı bunu `private/{uid}/data/push.ntokens` alanına yazsın (kurallar: sahibi yazar). `notify.mjs` → `notifyCall`/`notifyMissed`/mesajlar `ntokens`'a da göndersin (`android.priority=high`, veri mesajı).
6. Derleme: bu ortamda Android SDK yok. **GitHub Actions** ile derle (`.github/workflows/android.yml`): JDK 17, Gradle. İmza için GitHub Secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Bunları **kullanıcı** girer. Çıktı: imzalı APK + AAB artifact.
7. Test: kullanıcı telefonda, ekran kilitliyken arama.

Tahmini süre: birkaç saat (kod 1–2 saat, derleme denemeleri 30–60 dk, kullanıcı adımları 15–20 dk).

### C. Henüz yapılmayan özellikler
King, 101 Okey, Dama, Tombala, Tavla çeşitleri (Mahbusa, Gülbahar), grup sesli oda (145), topluluklar (127), usta-çırak (159), günlük meydan okuma (157), masada sohbet balonu (65), avatar/kıyafet (64), koleksiyon albümü (158), bilardo top setleri (161), sezon kartı, görüntülü aramada bulanıklaştırma (150), diller (60).

## 6. Son oturumda yapılanlar (9–10 Kasım)

- Okey: atılan taşlar sahibinin yanında ve isimli, Çanak Okey ayrı bölüm, okey ters, bitiş dizilimi hatası düzeltildi (okey serinin sonunda), desteye kaydırarak bitirme, çay molası, oylamayla atma.
- Bilardo: 3B dönen toplar (her topun yön matrisi, piksel gölgeleme), daha hızlı fizik, falso.
- Tavla: büyük ekran düzeni (container query), rakibin zarı ve hamleleri tek tek.
- Batak/Pişti: kartların kime gittiği animasyonu. Kızma Birader: elle zar, zıplayarak hareket.
- Domino (yeni oyun), çok elli maç (Pişti/Domino).
- Jeton yetmeyince otomatik "Yetersiz jeton" ekranı. Yönetimde kasa geliri (gün/hafta/ay). Şehir kilidi + şehir ödülü.
- Sohbet: toplu seçme/silme, arkadaş grupları, desenli arka plan, yumuşak bildirim/arama sesleri.
- Çıkış yap: menünün en üstünde + Profilim'de.
- Service worker: önbellekten anında açılış.
- Bildirim: cevapsız arama push'u, Ayarlar → Bildirimler → **Test bildirimi**.
- Firebase servis anahtarı yenilendi, eski 2 anahtar silindi. Yeni APK (Vercel adresli) üretildi.
