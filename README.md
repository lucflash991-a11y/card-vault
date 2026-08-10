# Card Vault v2.4.0 — Marketplace + Trust + Polish

Built on stable v2.3.2.

## New in v2.4
- Listing statuses: Not Listed, For Sale, For Trade, Sale + Trade, Pending Deal, Sold/Traded
- Market filters for sport, condition, min/max price and ask/value sorting
- Ask price vs estimated value display
- 48-hour offer expiration
- Cancel your own pending offer
- Proper offer details and counter-offer UI
- Estimated trade-side values + imbalance warning
- Sent / Read message status
- Tappable notifications + Mark all read
- Public profile completed-trade / sale / trade stats
- Public Market / Trades tabs
- Completed trade history
- Report User

## Firebase
Publish the included firestore.rules before testing v2.4. It adds `publicReports` and permits participants to update message read state.
