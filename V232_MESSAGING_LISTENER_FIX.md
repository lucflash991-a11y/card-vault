# Card Vault v2.3.2 — Messaging Listener Fix

Fixes messages clearing from the input but not appearing in chat.

Cause:
The app was listening to the entire `publicMessages` collection. The secure v2.3 Firestore rules do not allow a signed-in user to read every user's messages, so Firestore rejected that listener.

Fix:
- Chat now listens only to messages where `conversationId` equals the open conversation.
- Conversation listener now uses `participants array-contains currentUser.uid`.
- Notification listener now uses `targetUid == currentUser.uid`.
- Sent messages appear immediately while Firebase saves them.
- Failed sends are removed and show an error toast.

No new Firestore rules are required if the v2.3 rules are already published.
