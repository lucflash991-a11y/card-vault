# Card Vault v3.0.2 — Funko Barcode API

Live: Funko Vault, camera barcode scan where supported, manual UPC/EAN lookup, name search, upc.dev lookup, 0 Gemini calls for normal Funko lookup, separate Home/Vault/cloud storage.

Replace: public/index.html, public/styles.css, public/app.js, server/server.js, README.md.

No new Firestore rules are required if `users/{uid}/{document=**}` is still allowed for the signed-in user.
