# Card Vault v3.3.0 — Comics Barcode Vault

Live:
- Comic Vault
- iPhone/Safari barcode scanner
- UPC/EAN/ISBN manual lookup
- optional comic 5-digit supplement
- title + issue + publisher search
- UPCitemdb + Open Library lookup
- separate Comic Home/Vault/cloud storage
- 0 Gemini calls in normal comic lookup path

Replace:
- public/index.html
- public/styles.css
- public/app.js
- server/server.js
- README.md

No new Firebase rules required if users/{uid}/{document=**} remains allowed.
