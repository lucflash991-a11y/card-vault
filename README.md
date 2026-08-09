# Card Vault v1.0

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
