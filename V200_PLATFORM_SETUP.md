# Card Vault v2.0.0 Platform

Replace these GitHub files:
- public/index.html
- public/styles.css
- public/app.js
- server/server.js

Also update Firebase Firestore Rules using:
- firestore.rules

Firebase Console:
Firestore Database -> Rules -> paste the contents of firestore.rules -> Publish.

Test:
1. Profile shows BUILD v2.0.0.
2. Edit username/bio/favorite/profile photo.
3. Set Profile to Public and Vault visibility to Public.
4. Pick Showcase cards.
5. Open a card and switch Public card on.
6. Open Discover with another signed-in account/device.
7. Confirm the collector and card appear.
