# v1.0.6 save diagnostic

Replace:
- `public/app.js`
- `public/service-worker.js`

Commit and let Render redeploy.

Cloud Firestore now receives metadata only. Photos stay cached on the device. If saving still fails, Card Vault will display an alert containing the exact Firebase error code and message. Screenshot that alert.
