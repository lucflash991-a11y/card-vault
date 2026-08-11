# Card Vault v3.3.1 — Comic Scanner Rebuild

Major fixes:
- cover-photo-first comic identification
- Gemini only reads visible cover identity
- GCD verifies exact issue/variant
- real GCD cover images
- barcode fields clear after each lookup
- barcode only returns GCD-verified matches
- generic UPC prices removed
- new comics start unpriced
- optional manual value
- optional live market refresh
- manual title + issue GCD search uses 0 AI calls

Replace:
- public/index.html
- public/styles.css
- public/app.js
- server/server.js
- README.md

No new Firebase rules required.
