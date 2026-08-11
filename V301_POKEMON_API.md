# Card Vault v3.0.1 — Pokémon API Vault

## What is new
- Pokémon Vault is live.
- TCGdex REST API integration.
- No TCGdex API key needed.
- Pokémon API search uses 0 Gemini calls.
- Search by card/Pokémon name, card number, and optional set.
- Exact result selection.
- TCGdex metadata + image import.
- Available TCGPlayer price data from TCGdex.
- Separate Pokémon Home.
- Separate Pokémon Vault.
- Separate Firestore path: users/{uid}/pokemonCards.
- Guest local Pokémon collection support.
- Sports Card scanner is untouched.

## Replace in GitHub
- public/index.html
- public/styles.css
- public/app.js
- server/server.js
- README.md

## Firebase
No new Firestore rules are required if your existing rule still allows:
users/{uid}/{document=**}

## Test
1. Deploy and verify BUILD v3.0.1.
2. Choose Pokémon.
3. Search `Pikachu`, `Charizard ex`, etc.
4. Add a result.
5. Verify it appears on Pokémon Home and Pokémon Vault.
6. Sign into a second device/account session with the same Google account and verify Pokémon sync.
7. Switch back to Sports and verify Sports remains unchanged.
