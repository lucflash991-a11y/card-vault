# Card Vault v1.4.0 Mega Update

Replace these files in the current GitHub repo:
- public/index.html
- public/styles.css
- public/app.js
- server/server.js

Commit and let Render redeploy.

Important AI-efficiency change:
A normal scan now uses ONE Gemini request for both identification and a rough value estimate. Live web pricing is optional and manual. This is specifically designed to make the free Gemini quota last longer.

After deployment test:
1. Profile shows BUILD v1.4.0.
2. Scan a card.
3. Confirm the value is filled without pressing Live refresh.
4. Add it to the Vault.
5. Open the card detail page.
6. Favorite it, add notes, edit a field, save.
7. Test Live refresh only once.
8. Return home and verify analytics/trend/sport breakdown.
