# v1.0.5 Card save fix

Replace these files in GitHub:
- `public/app.js`
- `public/service-worker.js`

Commit and let Render redeploy.

Why this fixes it:
Card Vault was saving the full base64 front and back scan images inside each Firestore document. Firestore Native has a 1 MiB maximum document size. v1.0.5 keeps the full-resolution-ish scan images only in memory for AI identification, then creates much smaller thumbnails for the cloud Vault record.
