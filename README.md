# Card Vault v1.0.6

Major rebuild of the Card Vault PWA.

## What changed

### Modern UI
- Refined premium light mode
- Full dark mode
- Light / Dark / System appearance picker
- New portfolio dashboard
- Top-card highlight
- Cleaner Vault cards and filters
- New card detail screen with front/back viewer
- Better mobile spacing and iPhone Home Screen layout

### Accounts
- Firebase Authentication integration
- Continue with Google
- Sign in with Apple code path
- Guest mode
- Signed-in profile state
- Firestore cloud collection sync
- Guest-to-account collection migration

### AI scanner
- Front/back photo processing
- Safari-safe image loading
- Confidence scores
- Alternate matches
- Confirmation editor
- 50-second request timeout
- clearer errors and status states
- conservative identification prompt

### Bug fixes / hardening
- Duplicate-card bug fixed with one stable scan ID per scan
- Save button locks while writing
- Firestore save uses the scan ID as the document ID, making repeated saves idempotent
- Local save also replaces same ID rather than inserting duplicates
- Existing exact duplicate scans are deduplicated during migration
- Scan state fully resets after save
- Photo replacement resets stale AI results
- AI request cancellation
- Service worker cache bumped and old caches removed
- Express 5 wildcard crash fixed
- API rate limit protection
- Health/config endpoints
- local/cloud storage modes separated

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Gemini works when `GEMINI_API_KEY` is configured.
Guest mode works without Firebase.
See `FIREBASE_SETUP.md` to enable Google / cloud accounts and Apple support.

## Deploy
This repo includes `render.yaml`.

For an existing Render service, replace the GitHub project files with this version.
Keep your existing `GEMINI_API_KEY`.
Add `FIREBASE_WEB_CONFIG` when Firebase is ready.

## Important
Apple sign-in cannot simply be activated by frontend code. Apple requires the web Sign in with Apple developer configuration before the Firebase Apple provider can work.


## v1.0.1 Google sign-in hotfix
- Google login now uses `signInWithPopup()` first instead of redirect-first on iPhone/PWA.
- Firebase authentication is explicitly persisted with `browserLocalPersistence`.
- Redirect is retained only as a fallback when the browser blocks popups.
- Redirect recovery now restores the Firebase user before showing the app.
- Guest-mode state is cleared immediately after successful Firebase authentication.
- Login buttons lock while authentication is in progress.
- Service worker cache bumped so installed iPhone copies receive the fix.


## v1.0.2 authentication gate fix
- Successful Firebase authentication now opens Card Vault immediately.
- Firestore sync no longer blocks the transition away from the login screen.
- Cloud sync and theme sync run after the authenticated UI is visible.
- Firestore permission/network errors now show a sync warning instead of acting like login failed.
- Firestore live listener starts before guest-card migration.
- Service worker cache bumped to force the updated authentication code onto installed copies.


## v1.0.3 iPhone Safari Google auth fix
- Removed `signInWithRedirect()` completely.
- Google authentication is now popup-only.
- Fixes Firebase "Unable to process request due to missing initial state" caused by storage-partitioned Safari environments.
- If Safari blocks the popup, Card Vault now reports that instead of redirecting to a broken Firebase auth page.
- Removed stale redirect-result recovery code.
- Service worker cache bumped.


## v1.0.4 Safari same-site authentication fix
- Proxies Firebase Auth helper routes through the Render Card Vault domain.
- `/api/config` now reports the current Card Vault host as Firebase `authDomain`.
- Removes the Safari cross-site storage dependency on `firebaseapp.com`.
- Keeps Google popup authentication.
- Service worker cache bumped.


## v1.0.5 Firestore card-save fix
- Compresses card images to small vault thumbnails before writing to Firestore.
- Keeps AI scan photos high enough quality during recognition, but does not store those large originals in the Firestore document.
- Adds an 850 KB safety target below Firestore's 1 MiB document limit.
- Falls back to storing the front image only if a card document is still unusually large.
- Adds clearer save-error diagnostics.
- Service-worker cache bumped.


## v1.0.6 save diagnostic + metadata-only cloud records
- Firestore now stores card metadata only; scan photos no longer go into Firestore documents.
- Front/back images are cached locally on the current device and reattached when cloud card records load.
- This completely removes Firestore image/document-size issues from card saving.
- Any remaining save failure now displays the exact Firebase error code and message for diagnosis.
- Service worker cache bumped.
