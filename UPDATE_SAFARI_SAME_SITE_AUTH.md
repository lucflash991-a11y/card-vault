# Card Vault v1.0.4 — Safari same-site Firebase Auth

This is the robust fix for:

"Unable to process request due to missing initial state"

Firebase documents this as a cross-site storage problem on Safari.

## Deploy code
Replace:
- `server/server.js`
- `public/service-worker.js`

Commit to the existing GitHub repository and let Render redeploy.

## Render environment
Add:
`FIREBASE_PROJECT_ID=card-vault-1de81`

The server will automatically change the Firebase client `authDomain` to the current Render hostname.

## Google OAuth redirect URI
Because the auth handler will now be served under the Card Vault domain, Google must allow this URI:

`https://card-vault-npck.onrender.com/__/auth/handler`

Add it to the Firebase project's Google OAuth web client under Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client.

Keep the existing firebaseapp.com redirect URI too.

## Firebase Authorized domains
Keep:
`card-vault-npck.onrender.com`

## Test
After Render is Live:
1. Open `https://card-vault-npck.onrender.com` directly in Safari.
2. Refresh.
3. Tap Continue with Google.
4. Choose an account.
5. Card Vault should return to the Render domain and enter the signed-in app.
