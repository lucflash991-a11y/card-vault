# Updating your current Render/GitHub Card Vault to v1.0

You do NOT need to make a new Render service.

1. Back up your current GitHub repository if you want.
2. Upload/replace these v1.0 files in the SAME `card-vault` repository:
   - `public/`
   - `server/`
   - `package.json`
   - `render.yaml`
   - `.env.example`
   - `README.md`
   - `FIREBASE_SETUP.md`
   - `firestore.rules`
3. Commit the changes.
4. Render should auto-deploy.

Your existing Render `GEMINI_API_KEY` stays in Render and should not be changed.

## First test after deploy
1. Open the new Render URL in Safari.
2. Continue as guest.
3. Toggle dark mode in Profile.
4. Scan one card and save it.
5. Make sure exactly ONE card was added.
6. Open the card from My Vault.
7. Test Front / Back and Save changes.

Then configure Firebase by following `FIREBASE_SETUP.md`.

## iPhone Home Screen cache
v1.0 uses a new service-worker cache name. The app should update automatically.
If the old UI remains, remove the old Home Screen icon once, open the Render URL in Safari, refresh, then Add to Home Screen again.
