# Card Vault v1.0 — Account Setup

The app works immediately in Guest mode. Google / cloud sync require Firebase configuration.
Apple login code is included, but Apple requires its own developer-side configuration before it can be enabled.

## 1) Create a Firebase project
Go to Firebase Console and create a project named Card Vault.

## 2) Add a Web App
Project Overview → Add app → Web.

Firebase will show a config similar to:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Convert only the object into one-line JSON:

```json
{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}
```

In Render:
Environment → Add environment variable

Key:
`FIREBASE_WEB_CONFIG`

Value:
paste that one-line JSON.

Do NOT use a Firebase Admin service-account private key here.

## 3) Enable Google login
Firebase Console → Authentication → Get started → Sign-in method → Google → Enable.

Then Authentication → Settings → Authorized domains:
add your Render hostname, for example:

`card-vault-npck.onrender.com`

Do not include `https://`.

## 4) Create Firestore
Firebase Console → Firestore Database → Create database.

Then open Rules and replace the rules with the contents of `firestore.rules`, then publish.

These rules make each signed-in user able to access only their own `users/{uid}/...` data.

## 5) Redeploy
Render will normally redeploy after environment changes. If not:
Manual Deploy → Deploy latest commit.

After Google sign-in works, Card Vault automatically uses Firestore for that user's collection.
If the user already had guest cards on that browser, v1.0 attempts to migrate them into the account the first time.

## Apple login
The app already contains a Firebase Apple OAuth flow.

To actually enable the Apple button, Apple requires Sign in with Apple web configuration:
- an Apple Services ID,
- a registered web domain/return URL,
- a primary App ID with Sign in with Apple,
- Apple provider credentials configured in Firebase.

After that:
1. Enable Apple in Firebase Authentication.
2. Complete Firebase's Apple provider setup.
3. Set Render `APPLE_AUTH_ENABLED=true`.
4. Redeploy.

Until then, the Apple button remains visibly present but disabled so users do not hit a broken login flow.
