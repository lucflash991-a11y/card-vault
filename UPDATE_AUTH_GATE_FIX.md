# v1.0.2 Google login gate fix

This fixes this exact symptom:

1. Tap Continue with Google.
2. Google account selection/login succeeds.
3. Browser returns to Card Vault.
4. Card Vault still shows Continue with Google / Continue with Apple.

Cause:
The app waited for Firestore cloud setup before calling `showApp()`. A Firestore error could therefore leave a correctly authenticated Firebase user stuck behind the login UI.

Deploy these two files:
- `public/app.js`
- `public/service-worker.js`

Commit them to the existing GitHub repository and let Render redeploy.

After Render is Live:
- Open the Render URL in Safari/browser.
- Refresh.
- Try Continue with Google.
- Card Vault should enter the app immediately after Firebase authentication.
- If Firestore has a separate rules/config problem, the profile will show a cloud sync warning rather than returning to the login screen.
