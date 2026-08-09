# Google sign-in hotfix deployment

Upload/replace these files in the existing GitHub `card-vault` repository:

- `public/app.js`
- `public/service-worker.js`
- `README.md` (optional)

Commit the changes.

Render should automatically redeploy. If not:
Manual Deploy → Deploy latest commit.

After Render says Live:
1. Open the Render Card Vault URL in Safari.
2. Refresh once.
3. If using the Home Screen app and it still behaves like the old version, fully close Card Vault and reopen it.
4. If necessary, remove the old Home Screen icon once, reopen the Render URL in Safari, then Add to Home Screen again.
5. Tap Continue with Google.

Expected behavior:
- Google account chooser opens.
- After choosing the account, Card Vault opens the collection.
- Refreshing or reopening Card Vault should keep the Firebase session signed in.
