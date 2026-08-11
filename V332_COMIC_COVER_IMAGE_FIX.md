# Card Vault v3.3.2 — Comic Cover Image Fix

Fixes GCD comics showing the Card Vault placeholder instead of real cover art.

Changes:
- same-origin cover proxy
- robust GCD cover URL extraction
- issue-page fallback cover discovery
- 24-hour cover caching
- works in search results, Vault and detail pages

Replace:
- public/index.html
- public/app.js
- server/server.js
- README.md

No Firebase rule changes.
