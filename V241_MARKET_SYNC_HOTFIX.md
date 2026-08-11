# Card Vault v2.4.1 — Market Sync Hotfix

Fixes For Sale / For Trade cards not appearing on another account.

## Cause
v2.4 saved `listingStatus`, `forSale`, `forTrade`, and `askPrice` to the owner's private
`users/{uid}/cards/{cardId}` document, but the card-detail Save path did not refresh the
matching `publicCards/{uid_cardId}` document.

The Market on other accounts reads `publicCards`, so it could only see the older copy.

## Fix
- Saving card details now immediately refreshes the public card mirror.
- Existing v2.4 market listings are automatically repaired once after cloud cards load.
- Sale / Trade / Both listing status automatically enables Public Card.
- No new Firestore rules are required.

Build: v2.4.1
