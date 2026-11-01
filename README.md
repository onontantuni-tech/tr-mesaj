# TR

Uçtan uca şifreli mesajlaşma uygulaması (Firebase + Netlify).

- `src/app.js` — uygulama kodu (esbuild ile `public/app.js` olarak paketlenir)
- `public/` — yayınlanan site (HTML, ikonlar, manifest, service worker)
- `firestore.rules` — Firestore güvenlik kuralları (Firebase konsolundan yayınlanır)
- `test/` — testlerde Firebase yerine kullanılan sahte modüller

Netlify her `main` güncellemesinde `npm run build` çalıştırıp `public/` klasörünü yayınlar.
