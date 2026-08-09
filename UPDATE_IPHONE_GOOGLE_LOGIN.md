# v1.0.3 iPhone Google login fix

The error:
"Unable to process request due to missing initial state ... signInWithRedirect in a storage-partitioned browser environment"

means Firebase redirect authentication is running in Safari/iOS and losing its stored redirect state.

This build removes Firebase redirect auth completely.

Upload/replace:
- `public/app.js`
- `public/service-worker.js`

Commit to GitHub and let Render redeploy.

After Render says Live:
1. Open the normal Card Vault Render URL in Safari.
2. Refresh it.
3. Tap Continue with Google.
4. Google should open using Firebase popup authentication.
5. After selecting the account, Card Vault should open the signed-in app.

If Safari reports that the popup was blocked, make sure Card Vault is opened directly in Safari rather than an in-app browser and try again.
