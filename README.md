# Card Vault v3.3.3 — Strong Comic Matcher

Card Vault started as a sports-card scanner and collection tracker. v3.0 begins the transition into a **multi-collectible platform** while keeping every collectible category separated.

## Current Build

**v3.3.3**

Built from the stable **v2.4.2 Trade / Sale Flow Hotfix** baseline.

---

# What v3.0.0 Does

## New Vault Selector

After signing in or continuing as a guest, Card Vault now opens a collectible selector:

- **Sports Cards — LIVE**
- **Pokémon — coming in the 3.0.x rollout**
- **Comics — coming in the 3.0.x rollout**
- **Funko — coming in the 3.0.x rollout**

The categories are intentionally **not mixed together**.

Each category is designed to eventually have its own:

- Home
- Scanner
- Vault
- Discover
- Market
- Analytics

Your account, profile, followers, messages, notifications, blocking and reputation can remain shared across Card Vault.

## Sports Migration

Sports Cards is the fully active vault in v3.0.0.

Existing cards are automatically treated as:

```text
category: sports
```

New sports cards also save with the Sports category.

Nothing from the current Sports Vault needs to be manually moved.

## Switch Vault

A new **Sports** vault button appears in the Home header. It returns to the Vault Selector.

## v3.0.x Roadmap

### Pokémon
Planned Pokémon-specific fields include:

- Pokémon name
- set
- card number
- rarity
- holo / reverse holo
- EX / GX / V / VMAX / VSTAR
- illustration rare / special illustration rare
- trainer / energy
- language
- first edition where applicable
- grading company / grade
- value

### Funko
Planned Funko fields include:

- character
- franchise
- Pop number
- line / series
- exclusive
- Chase
- convention release
- year
- vaulted status
- box condition
- signed status
- value

### Comics
The Comic Vault is planned as **barcode-first**.

Preferred flow:

1. Scan UPC / EAN / comic supplemental barcode.
2. Look up the issue without Gemini when the barcode can identify it.
3. Fill issue metadata.
4. Use cover AI only when barcode lookup fails or the comic has no useful barcode.
5. Manual search remains another fallback.

Planned Comic fields include:

- title
- issue number
- publisher
- volume
- publication year
- variant
- printing
- cover artist
- key issue
- first appearance
- raw / slabbed
- grading company
- grade
- barcode
- value

---

# Full Card Vault Update History

This section tracks the major builds and hotfixes that led to v3.0.0.

## Early Card Vault

### v0.2
Early modern Card Vault concept.

Added / targeted:
- front and back card capture
- AI identification
- confidence scores
- multiple possible matches
- Add to Vault confirmation
- modern mobile-first UI
- free web/PWA direction

### v0.3
Early deployed web baseline before the v1 rewrite.

This was the older Render/GitHub version that the v1.0 update replaced while preserving the core scan-and-vault idea.

---

# v1 Series — Scanner, Cloud Sync, Pricing and Collection Tools

## v1.0
Major application baseline.

Added the foundation for:
- Card Vault web app/PWA
- Google/Firebase account support
- guest mode
- Firestore collection storage
- dark mode
- scanner + Vault workflow
- Render deployment
- Firebase setup and Firestore rules

## v1.0.2 — Auth Gate Fix
Fixed successful Google login returning to Card Vault but leaving the user stuck on the sign-in screen.

The authenticated app now opens even if a separate Firestore sync operation has a problem.

## v1.0.3 — iPhone Google Login Fix
Removed Firebase redirect authentication on iPhone/Safari.

Switched to popup authentication to avoid Safari's missing-initial-state problem.

## v1.0.4 — Safari Same-Site Firebase Auth
Added the stronger Safari authentication architecture.

- Firebase auth handler proxied through the Card Vault Render domain
- Render hostname used as Firebase auth domain
- Firebase project proxy routes
- Google OAuth redirect configuration updated

This solved Safari cross-site storage issues.

## v1.0.5 — Card Save Size Fix
Fixed Firestore saves failing because full front/back base64 images could exceed Firestore's document size limit.

Cloud card records switched to smaller image data.

## v1.0.6 — Save Diagnostic
Moved toward metadata-first cloud saves and added clearer Firebase error reporting so save failures could be diagnosed instead of silently failing.

## v1.0.7 — Cache-Proof Diagnostic
Added visible build numbering and cache-proof deployment checks.

Also disabled problematic service-worker behavior during debugging so users could confirm the newest Render deployment was actually loaded.

## v1.1.x — Market Value Foundation
Introduced automatic market-value ideas and AI-assisted value estimates while eBay developer access was still pending.

The goal was to provide useful value information without requiring a paid marketplace API.

## v1.1.9 — Free-Tier Pricing
Improved free-tier pricing behavior.

Flow:
- check local price cache
- try Gemini with Search grounding
- if quota-limited, retry without Search grounding
- clearly label fallback estimates
- never pretend AI estimates are real eBay sold averages

## v1.2.0 — Cross-Device Images
Fixed cards appearing without pictures on another device.

New behavior:
- original device keeps higher-quality local images
- Firestore stores compressed front/back thumbnails
- other signed-in devices receive those cloud thumbnails

## v1.4.0 — Mega Update
Major scanner / analytics / pricing upgrade.

Important change:
- normal card scan uses **one Gemini request** for identification + rough market estimate
- live pricing becomes optional/manual
- designed to stretch free Gemini quota

Also expanded:
- card detail editing
- favorites
- notes
- Home analytics
- trends
- sport breakdown

## v1.4.1 — Portfolio Trend Polish
Improved collection-trend / portfolio visuals.

## v1.5–v1.7 Development
A series of combined collection-management and scanner improvements that led into the v1.7 release.

## v1.7.0 — Mega Update
Added major collection-management and Scanner 2.0 functionality.

Home:
- Top Movers
- Top Players
- Top Sets

Vault:
- raw / graded filters
- favorites filter
- collection filter
- highest-profit sorting
- tags
- custom collections
- better search

Scanner 2.0:
- photo-quality feedback
- batch mode
- batch session counter
- save-and-continue batch workflow
- Finish Batch action
- slab / grade awareness
- parallel / variation awareness

## v1.7.1 — AI Endurance
Focused on making the free Gemini allowance last longer.

- high-throughput lightweight model first
- fallback model if capacity/quota is limited
- smaller image requests
- scan caching
- no automatic second pricing call during normal scan
- clearer quota errors
- no billing required by Card Vault

## v1.7.1 Hotfix
Fixed `scanModels` being declared in the wrong server route, which caused Identify Card requests to fail.

## v1.8–v1.9 Development
Combined UI, collection and Selling Mode work leading into v1.9.

## v1.9.0
Added selling/listing tools and a Wantlist experiment.

Selling tools included:
- suggested listing price
- profit-vs-paid indicator
- generated listing title
- generated listing description
- Copy Listing
- Facebook Marketplace draft
- eBay draft

These tools intentionally did not require extra Gemini calls.

## v1.9.1 — Remove Wantlist
Completely removed Wantlist while keeping Selling Mode.

---

# v2 Series — Social Platform, Discover, Trading and Messaging

## v2.0.0 — Card Vault Platform
Turned Card Vault into a collector platform.

Added:
- public/private collector profiles
- display name
- username
- bio
- favorite team/player
- profile photo
- profile privacy
- Vault privacy
- public cards
- Showcase / Top 6
- achievements
- personal activity
- Discover
- public collector profiles
- public cards

Home stayed focused on the owner's personal collection.

## v2.0.1 — Profile Hotfix
Fixed Profile and Showcase sheets/buttons that appeared unresponsive because modal styling was incomplete.

## v2.0.2 — Cross-Device Profile Sync
Made profile data truly cross-device.

Synced:
- collector name
- username
- bio
- favorite
- photo
- privacy settings
- Showcase / Top 6

## v2.1.0 — Discover Social Update
Expanded Discover.

Added:
- For You
- Following
- Cards / Market discovery foundation
- Collectors
- suggested collectors
- trending cards
- recently shared cards
- featured collections
- follow / unfollow
- follower / following counts
- card likes
- following feed

Added Firestore:
- `publicFollows`
- `publicLikes`

## v2.2 — Trading Foundation
The planned v2.2 work was rolled directly into the big v2.3 release rather than deployed separately.

Planned/merged features:
- For Trade
- For Sale
- Market
- cash offers
- card trades
- card + cash
- offer inbox
- accept / decline / counter

## v2.3.0 — Big 2.2 + 2.3 Update
Combined trading with communication.

Market:
- For Trade
- For Sale
- asking price
- Market inside Discover
- cash offers
- card offers
- multi-card offers
- cards + cash
- offer inbox

Messaging:
- private collector conversations
- profile Message button

Notifications:
- follows
- likes
- offers
- counters
- messages
- accepted / declined activity

Safety:
- Block User

Added Firestore:
- `publicOffers`
- `publicConversations`
- `publicMessages`
- `publicNotifications`
- `publicBlocks`

## v2.3.1 — Messaging Hotfix
Fixed the Send button appearing to do nothing in a brand-new conversation.

- stores recipient immediately
- no longer waits for Firestore conversation snapshot
- Enter sends
- Shift + Enter adds a new line
- failed sends show an error

## v2.3.2 — Messaging Listener Fix
Fixed sent messages clearing from the input but not showing in chat.

Cause:
the app tried to listen to all public messages, which secure Firestore rules correctly blocked.

Fix:
- conversation-specific message query
- rule-compatible conversation query
- rule-compatible notification query
- sent messages display immediately while saving

This became the stable messaging baseline.

## v2.4.0 — Marketplace + Trust + Polish
Expanded the Market and trade experience.

Added:
- listing statuses
  - Not Listed
  - For Sale
  - For Trade
  - Sale + Trade
  - Pending Deal
  - Sold / Traded
- Market sport / condition / price filters
- ask price vs estimated value
- 48-hour offer expiration
- cancel pending offers
- offer-detail screen
- counter-offer screen
- trade value comparison
- unbalanced-value warning
- Sent / Read messaging status
- tappable notifications
- Mark All Read
- public trade stats
- public profile tabs
- completed trade history
- Report User
- stronger blocking behavior

Added:
- `publicReports`

## v2.4.1 — Market Sync Hotfix
Fixed For Sale / For Trade cards not appearing on another account.

Cause:
private card data updated but the public Market mirror did not.

Fix:
- saving card listing updates refreshes `publicCards`
- existing listings get a one-time mirror repair
- sale/trade listing automatically enables public card sharing

## v2.4.2 — Trade / Sale Flow Hotfix
Fixed the completed-deal workflow.

Fixes:
- owners no longer make offers on their own cards
- owner sees **Manage Listing**
- listing owner can Accept / Decline / Counter
- sender can cancel while pending
- accepted deals require both sides to confirm completion
- first confirmation waits on the other user
- second confirmation moves the deal to Completed
- same workflow works for sale, trade and cards + cash

This is the stable v2 baseline used for v3.0.

---

# v3 Series — Multi-Collectible Card Vault

## v3.0.0 — Vault Selector Foundation
Current release.

Added:
- multi-collectible Vault Selector
- Sports / Pokémon / Comics / Funko category architecture
- Sports Cards remains fully active
- existing cards automatically treated as Sports
- category field added to collectible records
- switch-vault control on Home
- future vault metadata foundation
- separated-vault UX

Important:
**Pokémon, Comics and Funko are intentionally not active yet.**

This release builds the architecture first so the stable Sports Card app is not rewritten all at once.

---


## v3.0.1 — Pokémon API Vault

Pokémon is now the second fully active Card Vault category.

### TCGdex Integration

Card Vault now uses the TCGdex REST API as the primary Pokémon catalog.

Normal Pokémon database searches use:

**0 Gemini calls.**

No TCGdex API key is required.

Search supports:

- Pokémon/card name
- collector/card number
- optional set name

Card Vault fetches exact card details from TCGdex and can save:

- official card name
- collector number
- set
- rarity
- card category
- illustrator
- HP
- Pokémon types
- stage
- variants
- card image
- TCGdex ID
- available TCGPlayer market pricing exposed through TCGdex

### Pokémon Home

Pokémon now has its own Home dashboard with:

- Pokémon collection value
- card count
- set count
- average value
- recent cards
- top Pokémon
- top sets

### Pokémon Vault

Pokémon cards are stored separately from Sports Cards.

Signed-in users sync through:

```text
users/{uid}/pokemonCards/{cardId}
```

Guest users use their own local Pokémon storage.

### Pokémon Navigation

Pokémon has its own:

- Home
- Add / API Search
- Vault
- Discover foundation

Pokémon Discover is category-isolated but public Pokémon Market/social publishing is intentionally reserved for a later 3.0.x pass.

### Sports Safety

The Sports app was not converted to TCGdex and its Gemini scanner path was not changed.

### Free-First Design

TCGdex is used before any future AI fallback. The v3.0.1 Pokémon lookup itself does not call Gemini.



## v3.0.2 — Funko Barcode Vault

Funko is now live with a barcode-first, zero-AI path. It adds camera UPC/EAN scanning when supported, manual barcode entry, name search, public upc.dev product lookup, 24-hour lookup caching, a separate Funko Home and Vault, and cloud storage under `users/{uid}/funkoItems/{itemId}`. Sports and Pokémon remain separate.


# Current Core Features

## Sports Scanner
- front/back card scanning
- Gemini identification
- confidence / card metadata
- AI market estimate
- optional pricing refresh
- Scanner 2.0 quality checks
- batch mode
- free-tier quota-conscious architecture

## Sports Vault
- cross-device cloud sync
- cross-device thumbnails
- favorites
- tags
- collections
- search
- filters
- grading
- value / paid / profit
- portfolio history

## Social
- public profiles
- Showcase
- Discover
- follows
- likes
- collector search
- public cards

## Market / Trading
- sale / trade listings
- asking price
- offers
- counters
- cash
- cards
- cards + cash
- two-sided completion confirmation
- completed trade history

## Communication
- private messages
- Sent / Read
- notifications
- blocking
- reporting

---

# Free-First Architecture

Card Vault is intentionally designed to avoid paid infrastructure where practical.

- Gemini usage is quota-conscious
- no required paid Cloud Functions
- compressed images are stored in Firestore rather than requiring Firebase Storage
- social/trading logic runs client-side with Firestore security rules
- normal scans avoid unnecessary extra AI calls

---

# Deployment

Main files generally replaced during releases:

```text
public/index.html
public/styles.css
public/app.js
server/server.js
```

Some releases also require:

```text
firestore.rules
```

v3.0.0 does **not** require new Firestore rules beyond the rules already used by v2.4.2.

After deploying v3.0.2, verify:

```text
BUILD v3.3.3
```

in Card Vault.


## v3.2.1 — iPhone/Safari Barcode Hotfix
Adds Html5-Qrcode as an automatic fallback when Safari does not expose BarcodeDetector. UPC-A, UPC-E, EAN-13 and EAN-8 stay local and use 0 Gemini calls.


## v3.2.2 — Funko Lookup Fix

Fixed Funko barcodes and name searches returning no matches.

Cause:
- The prior Funko backend used an incorrect product API endpoint/response shape.
- The client also filtered returned name-search results too aggressively.

Fix:
- switched Funko product lookup to UPCitemdb's documented free Explorer API
- exact barcode lookup through `/prod/trial/lookup`
- name search through `/prod/trial/search`
- UPC-A / EAN handling including leading-zero retry
- no API key/signup required
- 100 combined free requests/day from the provider
- 24-hour Card Vault cache retained
- valid barcode hits are no longer discarded because the product title is formatted differently
- name results are ranked toward Funko products instead of hard-filtered away
- still 0 Gemini calls


## v3.3.0 — Comics Barcode Vault

Comics is now the fourth active Card Vault category.

### Comic Scanner
- iPhone/Safari camera barcode scanner
- UPC-A / UPC-E / EAN-13 / EAN-8
- manual UPC / EAN / ISBN entry
- optional 5-digit comic supplemental code
- 0 Gemini calls for normal barcode lookup

### Comic Lookup
- UPC/EAN product lookup through UPCitemdb
- ISBN lookup through Open Library for collected editions / graphic novels
- title + issue + publisher product search fallback
- 24-hour server cache

### Comic Vault
Separate cloud storage:

```text
users/{uid}/comicItems/{itemId}
```

Comic schema includes:
- title / series
- issue number
- publisher
- year / volume
- variant / printing
- cover artist
- key issue flag / note
- raw or graded info
- UPC
- 5-digit supplemental barcode
- ISBN
- image
- value

### Comic Home
- collection value
- comic count
- publisher count
- key issue count
- recent issues
- top publishers

### Important
v3.3.0 is barcode-first. It does not use Gemini for the normal Comic workflow.
A later Comic update can add cover-photo AI as the fallback for older comics or missing database records.


## v3.3.1 — Comic Scanner Rebuild

Rebuilt Comics after v3.3.0 proved that generic UPC product data was not accurate enough for individual comic issues and variants.

### Cover-photo first
- Take or upload the front cover.
- Card Vault uses one Gemini call to read visible title / issue / publisher / year / variant clues.
- The result is then verified against the Grand Comics Database.
- Users choose the exact GCD result instead of Card Vault automatically saving a guessed comic.

### Real comic cover images
Search results and saved comics use the cover URL returned by the Grand Comics Database.

### GCD metadata
Saved comics can include:
- GCD issue ID
- real cover image
- series/title
- issue number
- publisher
- publication year
- variant cover
- printing
- cover artist
- barcode + 5-digit supplement
- ISBN

### Safer barcode behavior
Barcode is now a verification/fallback path, not the source of truth.
- scanned barcode is cleared after every lookup
- supplement is cleared after every lookup
- only GCD-verified barcode matches are returned
- if an exact barcode cannot be verified, Card Vault tells the user to use a cover photo rather than returning a random product

### Better values
Generic UPC/product prices are no longer used as comic market values.
New comics start as `Not priced`.

Users can:
- enter a value manually
- optionally tap Refresh Market Value

Live refresh uses Card Vault's existing Gemini + web-search approach and tries to match the exact issue, variant, printing and grade. It is never automatic.

### Manual GCD search
Title + issue number searches the Grand Comics Database directly and uses zero Gemini calls.



## v3.3.2 — Comic Cover Image Fix

Fixed comic covers appearing as the Card Vault placeholder.

Cause:
- GCD cover URLs are not reliable to hotlink directly from the client.
- GCD API responses can expose cover information in different shapes.

Fix:
- all GCD comic covers now load through Card Vault's own `/api/comics/cover/{gcdId}` proxy
- proxy checks multiple GCD API cover fields
- if the API does not expose a usable cover URL, Card Vault inspects the public GCD issue page for its cover image
- image bytes are served through Render on the same origin as Card Vault
- covers are cached for 24 hours
- search results, Comic Vault cards and Comic Detail all use the proxy



## v3.3.3 — Strong Comic Matcher

Major Comics matching upgrade.

### Visual candidate ranking
Cover-photo identification now has two stages:
1. Gemini reads the visible series / issue / publisher / year / variant clues.
2. Card Vault retrieves candidate comic records and visually compares the real candidate cover scans to the user's photo.

Results are ranked with a visible match percentage and short reason.

### Multi-source metadata
- Grand Comics Database remains the no-setup primary source.
- Metron is automatically added as a second source when a Metron API token or username/password is configured on Render.
- candidates from both sources are merged and deduplicated.
- GCD IDs are used to merge equivalent Metron/GCD records when available.

Optional Render variables:
```text
METRON_TOKEN=your_revocable_metron_api_token
```
Or legacy Basic Auth:
```text
METRON_USER=your_username
METRON_PASS=your_password
```
Card Vault still works without any Metron credentials.

### Better cover reliability
- real database cover is preferred
- uploaded user cover photo is preserved as a fallback
- if a remote/database cover fails, Card Vault displays the user's own comic photo instead of the generic Card Vault placeholder

### Strong manual search
Manual title + issue search now uses the same merged candidate system and confidence scoring.

### Saved match provenance
Comics now store:
- source
- GCD ID
- Metron ID when available
- match confidence
- match reason
- user cover fallback photo

### AI usage
Cover-photo matching can use two Gemini calls: one to read the comic identity and one to visually rank candidate covers. Manual title/issue search still uses zero Gemini calls.
