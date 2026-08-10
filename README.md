# Card Vault v2.3.1 — Trade Center + Messaging Hotfix

Card Vault is a modern sports-card collection platform built for web and iPhone/Safari use.

## Current Version
**v2.3.1**

This release includes the planned **v2.2 trading update**, the **v2.3 messaging + notifications update**, and the **v2.3.1 messaging hotfix**.

## Main Features

### Collection
- Scan sports cards with AI
- Front + back card analysis
- Save cards to your Vault
- Cloud sync across devices
- Portfolio value tracking
- Collection analytics
- Favorites
- Tags
- Custom collections
- Raw / graded filters
- Selling Studio
- Batch scanning

### Discover
- For You
- Following
- Market
- Collectors
- Suggested collectors
- Trending public cards
- Recently shared cards
- Featured collections
- Follow / unfollow
- Followers / following counts
- Likes on public cards

### Market + Trading
- Mark cards **Open to Trade**
- Mark cards **For Sale**
- Optional asking price
- Browse cards in Market
- Filter For Trade / For Sale
- Cash offers
- Card-for-card offers
- Multi-card offers
- Cards + cash offers
- Received / Sent / Completed offer inbox
- Accept offers
- Decline offers
- Counter offers

Card Vault does **not** automatically remove or transfer cards from either user's Vault after a trade.

### Messaging
- Private messages between collectors
- Message collectors from their public profile
- Conversations connected to collectors and offers
- Enter to send
- Shift + Enter for a new line

### v2.3.1 Messaging Hotfix
Fixed an issue where the Send button could appear to do nothing when starting a brand-new conversation.

The app now:
- Stores the recipient immediately when chat opens
- Sends without waiting for Firestore to sync the conversation back first
- Shows an error if sending fails
- Temporarily disables the send button while sending
- Supports Enter to send

### Notifications
Notifications can be created for:
- New followers
- Likes
- Trade offers
- Counter offers
- Accepted / declined offers
- Messages

### Profiles
- Collector name
- Username
- Bio
- Favorite team/player
- Profile photo
- Public/private profile controls
- Public/private Vault controls
- Showcase / Top 6
- Followers / Following
- Public market cards
- Message button
- Block User

### Safety / Privacy
- Block collectors
- Private card data remains under each user's account
- No payment processing
- No shipping addresses
- No payment information stored

## Firebase

Card Vault uses Firebase Authentication and Firestore.

Current social collections include:

- `publicProfiles`
- `publicCards`
- `publicFollows`
- `publicLikes`
- `publicOffers`
- `publicConversations`
- `publicMessages`
- `publicNotifications`
- `publicBlocks`

The v2.3 Firestore rules must be published for trading, messaging, notifications, and blocking to work.

## Deployment

The app is deployed through Render and connected to the GitHub repository.

When updating the app, the main files are:

```text
public/index.html
public/styles.css
public/app.js
server/server.js
```

## AI

Card identification uses Gemini.

The current scan setup is designed to stay as quota-conscious as possible and uses the existing free-tier strategy.

## Planned

### v3.0
Card Vault will expand into separated collectible vaults while staying inside the same app.

Planned categories include:
- Sports Cards
- Pokémon
- Comics
- Funko
- Other collectibles

Each category will have its **own separate Home, Vault, Scan, Discover, and stats** while keeping the same Card Vault UI.

Collections will not all be mixed together on one Home screen.
