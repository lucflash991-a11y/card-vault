# Card Vault v2.3.1 — Messaging Hotfix

Fixes the Send button appearing to do nothing when opening a brand-new conversation.

Cause:
The app waited for Firestore's conversation snapshot before it knew who the active recipient was.

Fix:
- Recipient is stored immediately when chat opens.
- Send no longer depends on the conversation snapshot arriving first.
- Send button temporarily disables while sending.
- Enter sends the message.
- Shift+Enter adds a new line.
- Visible error toast if a message actually fails.

No new Firestore rules are required if the v2.3 rules are already published.
