# Product Requirements Document (PRD)
## Music Rights Marketplace — Simple Core Edition

## 1. Overview & Objective

A centralized digital marketplace connecting Music Labels and Independent Artists directly with Agencies, Brands, and Content Creators. The platform simplifies music synchronization licensing by allowing rightsholders to list audio tracks with predefined permissions, enabling buyers to purchase clear, usage-based licenses in a single checkout while preventing platform copyright strikes.

## 2. Core Stakeholders & Roles

### 1. Music Label / Artist (The Seller)
Independent artists, composers, and regional labels.
- Uploads tracks (WAV/MP3) and sound metadata.
- Sets base pricing and permitted usage channels.
- Receives transparent sales metrics and direct payouts.

### 2. Creator / Influencer (Individual Buyer)
Vloggers, reel makers, and individual creators.
- Discovers music by mood, genre, and language.
- Buys affordable single-video organic licenses.
- Obtains instant PDF certificate & channel protection.

### 3. Commercial Brand (Direct Buyer)
Corporate marketing, D2C, and growth teams.
- Licenses tracks for brand organic and paid ads.
- Enters social accounts and ad IDs for whitelisting.
- Receives GST tax invoices and compliance documentation.

### 4. Advertising Agency (Bulk Buyer)
Creative agencies and influencer management firms.
- Maintains multi-client workspace for multiple brands.
- Licenses tracks across full campaigns and multiple videos.
- Consolidates invoices, reporting, and creator permissions.

### 5. Platform Admin (Operations & Legal Support)
Internal verification, finance, and rights management personnel.
- Reviews new seller tracks and verifies ownership documentation before listing.
- Manages disputes by issuing automated releases via YouTube and Meta API connections.
- Oversees revenue reconciliation, platform commissions, and seller disbursements.

## 3. Product Modules & Functional Scope

### Module 1: Seller Portal & Catalog Management
- **Track Ingestion:** Audio upload with metadata (Title, Artist, Genre, Mood, Language, BPM).
- **Usage Rights Definition:** Seller flags permitted uses (organic social, paid ads, cuts/edits).
- **Earnings & Payouts:** Transparent royalty ledger showing sales volume, splits, and bank withdrawals.

### Module 2: Discovery & Watermarked Audio Player
- **Faceted Search:** Filter catalog by mood, genre, language (Hindi, Punjabi, Tamil, English, etc.), and media type.
- **Waveform Player:** Seamless streaming player with audio watermarking to prevent unauthorized recording.
- **Alternative Suggestions:** Recommends acoustically similar tracks if a selected song is out of budget.

### Module 3: Purpose-Based Licensing Engine

| License Tier | Target Buyer | Permitted Usage | Channel Scope |
|---|---|---|---|
| Creator / Personal | Influencer, vlogger | 1 Video, organic only | YouTube, Instagram, Facebook organic posts |
| Brand Organic | Small businesses, D2C | Up to 3 Videos, organic | Official brand handles, no paid ad spend |
| Paid Ad Campaign | Brands, growth teams | Ad creatives, boosted posts | Meta Ads, Google Ads, OTT digital pre-roll |
| Commercial / Broadcast | Agencies, production houses | Multi-video, high reach | TV, OTT, Cinema, comprehensive digital ads |

### Module 4: Automated Documentation & Platform Whitelisting
- **PDF License Certificate:** Instant generation post-checkout with unique License ID, Licensee Name, Track Details, Permitted Channels, and cryptographic verification hash.
- **Public Verification Link:** Scannable QR code directing to `platform.com/verify/{license_id}`.
- **API Whitelisting:** Programmatic channel/account registration with YouTube Content ID and Meta Rights Manager to prevent automated strikes, muting, or ad blocks.

### Module 5: Dispute Resolution
- **One-Click Reporting:** Buyers submit flagged video URLs directly from their dashboard.
- **Fast-Track SLA:** Platform Admins release automated claims within 24 to 48 hours via API or direct partner contacts.

## 4. End-to-End Operational Workflow

1. **Track Listing:** Artist or Label uploads audio and sets rights → Admin verifies ownership → Track is published.
2. **Discovery & Selection:** Agency, Brand, or Creator filters tracks, previews watermarked audio, and selects their intended license tier.
3. **Instant Checkout:** Buyer enters their target social handle or ad account and completes payment via UPI, Card, or Netbanking.
4. **Automated Fulfillment:** Platform issues the official PDF License Certificate and GST invoice, updates YouTube/Meta whitelists, and credits the seller's royalty balance.
5. **Safe Publishing:** Buyer publishes their content with verified commercial sync rights and zero copyright strikes.
