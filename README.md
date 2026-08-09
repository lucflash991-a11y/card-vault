# Card Vault v1.4.0 — Mega Update

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


## v1.0.7 cache-proof diagnostic build
- `index.html` loads `/app.js?v=107`.
- HTML and app.js are served with no-cache headers.
- Old service workers are automatically unregistered and Cache Storage is cleared.
- Profile visibly shows `BUILD v1.0.7`.
- Save failures show a `CARD VAULT v1.0.7 SAVE ERROR` alert with the exact Firebase code/message.
- `/api/version` returns the live server build number.


## v1.1.7 Market Intelligence
Automatic pricing UI and backend contract are ready. It intentionally shows eBay approval pending instead of fabricating prices.


## v1.1.8 AI Web Market Estimate
Gemini now uses Google Search grounding to research the exact card on the live web and return an AI market estimate, estimated range, confidence, and up to five clickable source links. This is labeled as an AI estimate, not an official eBay sold average.


## v1.1.9 Free-Tier Pricing Fallback
- Live Google Search-grounded pricing remains the first choice.
- If Search grounding returns HTTP 429, Card Vault automatically retries with a lighter Gemini request without web grounding.
- Fallback results are clearly labeled `AI estimate • limited data`.
- Fallback confidence is capped at Medium and normally Low.
- Price estimates are cached on-device for 12 hours per exact card identity so rescans do not repeatedly burn free API requests.
- Automatic pricing uses the cache; the `Update Value` button forces one fresh attempt.
- No billing is required by Card Vault itself.


## v1.2.0 Cross-Device Card Photos
- Card data and compact card thumbnails now sync through Firestore.
- Original full-resolution scan photos remain cached on the device that captured them.
- Other signed-in devices receive the synced front/back thumbnails automatically.
- Cloud thumbnails are aggressively compressed to keep Firestore documents safely below the size limit.
- If a record is unusually large, Card Vault falls back to syncing only the front thumbnail rather than failing the card save.
- Existing v1.1.9 free-tier AI pricing behavior remains intact.


## v1.4.0 Mega Update

This combines the planned v1.2.1, v1.3, and v1.4 work.

### AI Efficiency (v1.2.1)
- Identification + rough value estimate happen in ONE Gemini request.
- No automatic second pricing request after every scan.
- Exact scan results are cached on-device for 7 days.
- Live pricing is optional/manual.
- Live prices are cached for 24 hours in the browser and on the Render process.
- HTTP 429 never triggers another fallback Gemini call; Card Vault keeps the existing scan estimate.
- Duplicate button presses remain guarded.

### Portfolio Dashboard (v1.2.1)
- Invested amount
- Profit/loss
- Average card value
- 30-day collection trend chart
- Sport breakdown
- Top-card highlight
- Portfolio snapshots retained for up to 90 days on device

### Pricing (v1.3)
- Rough AI price included with card identification
- Automatic value field population without another request
- Optional Live Refresh using grounded web search
- 24-hour caching
- Pricing source, confidence, range, freshness, and source links
- Price history per card
- Live refresh rate limiting falls back to the existing estimate rather than failing the card

### Card Details (v1.4)
- Full front/back gallery
- Favorite cards
- Edit player, team, year, set, card number, parallel, serial, grade, paid, and value
- Profit/loss
- AI match confidence
- Value intelligence
- Live price refresh
- Clickable price sources
- Price-history chart
- Notes
- Delete card

Cross-device cloud thumbnails, Google accounts, Firestore sync, dark mode, and the existing scan/save fixes remain intact.
