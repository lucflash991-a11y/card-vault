# Card Vault v2.4.2 — Trade / Sale Flow Hotfix

Fixes two major Market issues:

1. Owners could make an offer on their own listing.
2. Accepted sale/trade offers did not have a proper two-sided completion flow.

## New flow
- Another collector makes an offer.
- Listing owner can Accept, Decline, Counter, or Message.
- Offer sender can Cancel while pending.
- After acceptance, BOTH users get Confirm Completed.
- First confirmation is saved as waiting on the other side.
- Second confirmation moves the deal to Completed.
- Works for cash sales, card trades, and card + cash offers.

## Owner listings
Your own Market listings now show `Manage Listing` instead of `Make Offer`.

No new Firestore rules are required if your v2.4 rules are already published.
