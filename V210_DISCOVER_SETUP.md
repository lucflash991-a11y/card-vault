# Card Vault v2.1.0 — Discover Social Update

## Replace in GitHub
- public/index.html
- public/styles.css
- public/app.js
- server/server.js

## IMPORTANT: Update Firestore Rules
This version adds two social collections:
- publicFollows
- publicLikes

Firebase Console:
Firestore Database -> Rules -> replace with `firestore.rules` -> Publish.

## Test
1. Profile should show BUILD v2.1.0.
2. Open Discover.
3. Test For You / Following / Cards / Collectors tabs.
4. On a second account, make a public profile + public cards.
5. Follow that collector.
6. Confirm follower count changes and their cards appear under Following.
7. Like a public card.
8. Confirm the like count updates on both accounts.
9. Search cards and collectors.
10. Home should look the same as before.
