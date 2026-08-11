# Card Vault v3.0.0 — Vault Selector Foundation

## Replace in GitHub
- public/index.html
- public/styles.css
- public/app.js
- server/server.js
- README.md

## Firebase
No new Firestore rules are required beyond the working v2.4.2 rules.

## What is live
- Sports Cards

## What is visible but intentionally not active yet
- Pokémon
- Comics
- Funko

These categories are separated from Sports and will be activated in later 3.0.x builds.

## Test
1. Deploy to Render.
2. Confirm BUILD v3.0.0.
3. Sign in.
4. Confirm the Vault Selector appears.
5. Tap Sports Cards.
6. Confirm the existing Sports Home/Vault/Discover/Market still works.
7. Tap the Sports switcher in the Home header.
8. Confirm it returns to the selector.
9. Tap Pokémon, Comics or Funko and confirm the Coming Soon panel appears without mixing those collections into Sports.
