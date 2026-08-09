# v1.0.7 — cache-proof diagnostic

For this update, replace THREE files:
- `public/index.html`
- `public/app.js`
- `server/server.js`

`public/service-worker.js` can also be replaced, but v1.0.7 unregisters service workers.

Commit and let Render deploy.

Verify:
1. Open Profile in Card Vault.
2. At the bottom you MUST see `BUILD v1.0.7`.
3. If you do not see it, the new deployment is not what the phone is loading.
4. If saving fails on v1.0.7, an alert will say `CARD VAULT v1.0.7 SAVE ERROR` and include the real Firebase error code/message.
