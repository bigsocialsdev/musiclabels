# PRD Analysis — Music Rights Marketplace (Simple Core Edition)

Source: `docs/PRD.md`. This document is an analyst's expansion of the PRD for planning purposes. It is not a spec or a final schema — gaps are flagged as ASSUMPTIONS and unresolved items are listed as Open Questions.

---

## 1. Actors

### 1.1 Music Label / Artist (Seller)
- **Responsibilities:** upload tracks + metadata, define permitted usage/pricing, submit ownership proof for verification, manage catalog, withdraw royalties.
- **Sees/does:** own catalog, own sales/royalty ledger, own payout history, dispute notifications involving their tracks.
- **Owns data:** track audio masters, metadata, ownership/rights documents, bank/payout details, sales history.

### 1.2 Creator / Influencer (Individual Buyer)
- **Responsibilities:** browse/discover tracks, purchase single-video "Creator/Personal" license, submit their channel/handle for whitelisting, publish content.
- **Sees/does:** catalog (watermarked previews), own purchase history, own licenses/certificates, dispute reporting for own videos.
- **Owns data:** personal account info, social handle(s), purchase/license records.

### 1.3 Commercial Brand (Direct Buyer)
- **Responsibilities:** purchase Brand Organic / Paid Ad Campaign licenses, submit social accounts and ad account IDs for whitelisting, receive GST invoices.
- **Sees/does:** catalog, own licenses, own invoices/compliance docs, own disputes.
- **Owns data:** company/GST details, social + ad account identifiers, invoices.

### 1.4 Advertising Agency (Bulk Buyer)
- **Responsibilities:** manage a multi-client workspace, license tracks on behalf of multiple brand clients/campaigns, consolidate invoicing/reporting, manage creator permissions across clients.
- **Sees/does:** workspace-level dashboard spanning multiple client sub-accounts; per-client licenses and whitelisting entries; consolidated reporting.
- **Owns data:** client roster, per-client campaign/license mappings, consolidated billing records. Note: this actor implies a sub-tenant/sub-account data model not detailed elsewhere in the PRD.

### 1.5 Platform Admin (Operations & Legal)
- **Responsibilities:** verify seller ownership documentation before publishing tracks; manage dispute resolution (issue automated releases via YouTube/Meta APIs or direct partner contact); oversee revenue reconciliation, commissions, and seller disbursement.
- **Sees/does:** full catalog including unpublished/pending tracks, all disputes, all transactions, commission/payout ledgers, partner-API dashboards.
- **Owns data:** verification decisions/audit trail, dispute case records, commission configuration, platform-wide financial reconciliation data.

### 1.6 Implicit / External Actors (not named as stakeholders in §2 but required by the modules)
- **System / Automated Job Runner:** executes watermarking on upload, PDF certificate + invoice generation, QR/verify-link creation, whitelisting API calls, royalty crediting — all described as "automated"/"instant." Needs to be modeled as an actor since it performs irreversible actions (whitelisting, payout crediting) without a human in the loop per transaction.
- **Payment Processor (UPI/Card/Netbanking gateway):** processes buyer checkout; implies an Indian PSP (e.g., Razorpay/Cashfree/PayU). Owns transaction/settlement data; platform only retains references.
- **YouTube Content ID API / Meta Rights Manager API:** external rights-management systems that the platform calls to whitelist buyer channels/ad accounts and to release claims. These are third-party-controlled approval processes, not platform-owned (see §8 Open Questions).
- **Bank Payout Rail (for seller disbursement):** external financial rail (e.g., NEFT/IMPS via a payout API or the same PSP) that actually moves money to sellers; distinct from the inbound payment processor.
- **Audio Watermarking Service:** either an in-house DSP pipeline or a third-party forensic watermarking vendor; PRD does not specify which (see §5, §8).

---

## 2. Modules — functional breakdown and ambiguities

### Module 1: Seller Portal & Catalog Management
Implied features:
- Audio upload (WAV/MP3) with file validation (format, duration, bitrate, max size).
- Metadata form: Title, Artist, Genre, Mood, Language, BPM — likely also needs ISRC/ISWC, composer/publisher splits, release date, cover art (not mentioned but typical).
- Usage-rights flags at upload time (organic social / paid ads / cuts-edits) — this must map onto the Module 3 license tiers, but the PRD doesn't say whether a seller opts into specific tiers per track or whether all tiers are available for every track at seller-set prices per tier.
- Ownership/ rights documentation upload for admin verification (PRD doesn't specify accepted document types — PRO registration, publishing agreement, self-declaration, etc.).
- Royalty ledger: sales volume, splits, withdrawal requests — "splits" implies multiple rightsholders per track (e.g., composer/label/performer), but no split-configuration UI is described (see Open Questions).
- Payout/withdrawal flow to bank account — KYC step is implied but not described.
- **Ambiguities:** Can a seller edit/delist a published track? Is there versioning if the audio file is replaced? Is pricing per license tier set by the seller or platform-wide? What happens to a track mid-dispute (auto-unpublished)?

### Module 2: Discovery & Watermarked Audio Player
Implied features:
- Faceted search/filtering by mood, genre, language, media type (BPM filtering implied by metadata but not explicitly listed as a search facet).
- Streaming player with audio watermarking applied to preview streams (to deter unauthorized recording/ripping).
- "Alternative Suggestions" — acoustic-similarity recommendation engine when a track is out of the buyer's budget; implies audio fingerprinting/similarity search, not just metadata-tag matching.
- **Ambiguities:** Is the watermark audible (deterrent) or inaudible/forensic (traceable)? Is a full, unwatermarked track ever streamed pre-purchase? Does "out of budget" mean the buyer entered a budget filter, or is it inferred from cart abandonment? How is "acoustically similar" computed (PRD doesn't specify ML/fingerprinting vendor)?

### Module 3: Purpose-Based Licensing Engine
The table defines 4 tiers (Creator/Personal, Brand Organic, Paid Ad Campaign, Commercial/Broadcast) with target buyer, permitted usage, and channel scope. Implied functional requirements:
- A rules engine that enforces tier constraints at checkout (e.g., caps "1 video" or "3 videos," restricts channel scope) and at whitelisting time (only whitelist channels allowed under the purchased tier).
- Pricing per tier (not specified — flat platform price vs seller-set price per tier vs dynamic pricing).
- Validation that the buyer's declared usage (e.g., entering an ad account ID) matches the tier purchased (e.g., Paid Ad Campaign requires an ad account ID; Creator/Personal does not).
- **Ambiguities:** What happens if a Creator/Personal licensee wants a 2nd video — do they buy a 2nd license, or upgrade? Is upgrading supported? Are tiers mutually exclusive on a single track (exclusive license) or can multiple buyers hold different-tier licenses on the same track simultaneously (see Open Questions on exclusivity)? Is there a time limit (e.g., 1 year) on any tier, or are licenses perpetual?

### Module 4: Automated Documentation & Platform Whitelisting
Implied features:
- PDF generation service: License ID, Licensee Name, Track Details, Permitted Channels, cryptographic verification hash — must be generated "instantly" post-checkout, implying synchronous or near-synchronous job execution.
- Hash generation + storage, and a public verification page at `platform.com/verify/{license_id}` that looks up a license and renders a human-readable legitimacy check (likely non-sensitive fields only).
- QR code generation encoding the verify URL, embedded in the PDF.
- API integration layer to YouTube Content ID and Meta Rights Manager to register the buyer's channel/ad account/handle against the specific track's rights so the platform's claim doesn't trigger automatically.
- GST invoice generation (for Brand/Agency; unclear if Creator tier also gets a GST invoice, since GST applies to B2B/B2C differently).
- **Ambiguities:** What exactly gets whitelisted — a channel-wide allowlist, or a per-video allowlist? Does whitelisting happen before or after the buyer actually uploads the video (i.e., does the buyer submit a video URL, or only a channel/handle)? What's the fallback if the Content ID/Rights Manager API call fails or is rate-limited — does checkout still complete?

### Module 5: Dispute Resolution
Implied features:
- Buyer-facing "one-click" report form (flagged video URL) from their dashboard.
- Admin queue showing disputes, linked to license + track + whitelisting record.
- Resolution path: either automated API release (calling YouTube/Meta to lift an erroneous claim/strike) or escalation to a direct human partner contact at YouTube/Meta.
- SLA tracking: 24–48 hour fast-track target.
- **Ambiguities:** What counts as "resolved" — claim lifted, or also monetization/visibility restored? Is there a dispute status visible to the buyer (open/in-progress/resolved)? What if the strike is valid (e.g., buyer exceeded their license scope) — does the admin deny the dispute, and is there then a penalty/revocation process? Who is liable to the buyer if the SLA is missed or the API release fails (see Open Questions)?

---

## 3. Data entities (analysis only — not a final schema)

- **User/Account** — id, role (Seller/Creator/Brand/Agency/Admin), name, contact, auth credentials, KYC status (sellers), GST number (Brand/Agency), created_at.
- **AgencyWorkspace** — id, owning Agency account, billing config. Has many **Client** sub-records (brand/campaign identity under the agency).
- **Client** (agency sub-account) — id, workspace_id, client name, contact, associated social/ad accounts.
- **Track** — id, seller_id, title, artist, genre, mood, language, BPM, file refs (master + watermarked preview), ISRC/ISWC (assumed), verification_status (pending/verified/rejected), published flag, created_at.
- **RightsDocument** — id, track_id or seller_id, document type, file ref, admin reviewer_id, decision, decision_notes, timestamp.
- **RightsholderSplit** — id, track_id, rightsholder_name/user_id, split_percentage. (Needed if payouts are split across co-writers/labels — PRD mentions "splits" but no entity is described; flagged as analysis addition.)
- **LicenseTier** — id, name (Creator/Personal, Brand Organic, Paid Ad Campaign, Commercial/Broadcast), permitted_usage rules, channel_scope rules, default_price (or seller_price if per-track pricing).
- **License** — id, track_id, buyer_id (and client_id if agency-purchased), tier_id, license_id (public code), issued_at, expiry (if any), status (active/revoked/disputed), verification_hash.
- **Transaction/Order** — id, buyer_id, license_id(s), amount, payment_method (UPI/Card/Netbanking), payment_gateway_ref, status, timestamp.
- **Invoice** — id, transaction_id, GST details, invoice number, PDF ref.
- **Certificate** — id, license_id, PDF ref, QR code ref, verification_hash, public_verify_url.
- **WhitelistRegistration** — id, license_id, platform (YouTube/Meta), channel_or_account_id, api_request_ref, status (pending/active/failed), registered_at.
- **Payout** — id, seller_id, amount, period, bank_ref, status, timestamp.
- **Dispute/Claim** — id, license_id, reporter_id (buyer), flagged_video_url, platform, status (open/in_review/resolved/denied), admin_id, resolution_notes, opened_at, resolved_at, sla_deadline.
- **Commission** — platform-side config/record of take-rate applied per transaction (implied by "platform commissions" in Admin responsibilities; no detail given).

Relationships (high level): Seller 1—N Track; Track 1—N RightsDocument; Track 1—N RightsholderSplit; LicenseTier 1—N License; Track 1—N License; Buyer/Client 1—N License; License 1—1 Certificate; License 1—N WhitelistRegistration; License 1—N Dispute; Transaction 1—N License (bulk/agency checkout may buy several licenses in one order); Transaction 1—1 Invoice; Seller 1—N Payout; AgencyWorkspace 1—N Client; Client 1—N License (when bought via agency).

---

## 4. User flows

### 4.1 Seller onboarding & track listing
1. Seller registers account, submits KYC/payout details (ASSUMPTION — not explicit in PRD).
2. Seller uploads track (WAV/MP3) + metadata (Title, Artist, Genre, Mood, Language, BPM).
3. Seller flags permitted usage categories and sets pricing (mechanism unspecified).
4. Seller submits ownership/rights documentation.
5. Admin reviews documentation and audio; approves or rejects.
6. If approved: track is watermarked, published to catalog, searchable.
7. If rejected: seller notified with reason (process unspecified — see Open Questions), track stays unpublished; seller may resubmit.

### 4.2 Buyer discovery & license purchase
**Creator:**
1. Browses/searches by mood/genre/language; previews watermarked audio.
2. Selects track, chooses Creator/Personal tier.
3. Enters target channel/handle.
4. Pays via UPI/Card/Netbanking.
5. Receives PDF certificate + is whitelisted; publishes video.

**Brand:**
1. Searches catalog; previews track.
2. Selects Brand Organic or Paid Ad Campaign tier.
3. Enters social account(s) and, for paid tier, ad account ID(s).
4. Pays; receives GST invoice + certificate; accounts whitelisted on YouTube/Meta.

**Agency:**
1. Logs into agency workspace; selects/creates a client.
2. Searches catalog on behalf of client; selects Commercial/Broadcast (or other) tier.
3. Attaches license to a specific client's campaign; enters channels/ad accounts for that client.
4. Pays (consolidated or per-client — unspecified, see Open Questions); receives consolidated invoice and per-client certificates; whitelisting applied per client's accounts.

### 4.3 Automated fulfillment (post-checkout)
1. Payment confirmed by gateway.
2. System generates PDF certificate (License ID, licensee, track, channels, hash) + QR code linking to public verify page.
3. System generates GST invoice (Brand/Agency; Creator status unclear).
4. System calls YouTube Content ID / Meta Rights Manager APIs to whitelist the buyer's declared channel/ad account for the specific track.
5. System credits seller's royalty ledger (minus platform commission).
6. Buyer notified fulfillment is complete ("instant").

### 4.4 Dispute reporting & resolution
1. Buyer's video gets struck/muted/blocked despite license.
2. Buyer submits flagged video URL via one-click report in dashboard.
3. Dispute record created, linked to license + whitelisting record.
4. Admin reviews; triggers automated claim release via API, or contacts YouTube/Meta partner support directly if API path fails.
5. Target SLA: 24–48 hours to resolution.
6. Buyer notified of outcome; dispute closed (or escalated if SLA missed — process unspecified).

### 4.5 Payout / royalty flow for sellers
1. Each completed transaction credits the seller's royalty ledger (gross amount minus platform commission, and minus any configured rightsholder splits).
2. Seller views ledger (sales volume, splits, running balance).
3. Seller requests withdrawal to bank account.
4. Admin/system processes payout via bank payout rail; payout status recorded.

### 4.6 Agency multi-client workspace management
1. Agency admin adds/manages Client sub-accounts within their workspace.
2. Agency purchases licenses attributed to a specific client.
3. Agency views consolidated reporting across all clients, and/or per-client reporting.
4. Agency manages "creator permissions" per client (PRD phrase, meaning unclear — possibly which creators/handles are authorized under each client) — see Open Questions.

---

## 5. Integrations

| Integration | What the PRD assumes | What's unspecified |
|---|---|---|
| YouTube Content ID API | Platform can programmatically whitelist channels and release claims | Content ID access is NOT self-serve; requires a formal partner relationship with YouTube. No mention of how/when this partnership is secured, or fallback if access is denied/delayed. |
| Meta Rights Manager API | Same programmatic whitelisting/release capability for Meta (Facebook/Instagram) | Rights Manager is also a gated, approval-based program (requires being a recognized rights owner/agent at scale). Same access-risk as above. |
| Payment gateway (UPI/Card/Netbanking) | Instant checkout and fulfillment | Strongly implies an Indian PSP (e.g., Razorpay, Cashfree, PayU, Instamojo). Not named. No mention of refunds, chargebacks, or multi-currency. |
| Audio watermarking | Applied to streaming preview to deter unauthorized recording | Vendor/technique unspecified: forensic/inaudible watermark (traceable, enables leak tracking) vs. audible/deterrent watermark (cheaper, less legally useful). No mention of removing the watermark from the buyer's delivered/licensed file (if buyers receive a clean master vs. only the certificate). |
| PDF generation | Instant certificate generation with hash | Library/service unspecified (assumed in-house, e.g., a PDF templating lib) — low risk, but hash algorithm and signing key management unspecified. |
| QR code generation | Encodes the verify URL | Trivial/standard; no issues assumed. |
| GST invoicing / tax compliance | Brand/Agency receive GST invoices | No mention of GSTIN validation, invoice numbering compliance (GST e-invoicing rules), or whether platform itself is the seller-of-record (marketplace GST treatment under Indian law is non-trivial — TCS collection obligations likely apply). |
| Bank payout rails | Sellers receive "direct payouts" | Mechanism unspecified — same PSP's payout API, a separate payout aggregator (Cashfree Payouts, RazorpayX), or manual bank transfer. KYC/beneficiary verification unspecified. |
| Audio storage/CDN/streaming | Implied by "seamless streaming player" | No mention of storage provider, CDN, adaptive bitrate, or protection against direct file URL scraping (separate from watermarking). |
| Audio similarity/fingerprinting (Module 2) | "Alternative Suggestions" of acoustically similar tracks | No vendor/algorithm named (e.g., embedding-based similarity vs. fingerprinting library). |

---

## 6. Non-functional needs

- **Security:** protect master audio files from unauthorized download; secure the watermarking pipeline; prevent license/certificate tampering (hash must be cryptographically signed, not just a checksum, and the verify page must recompute/compare server-side, not trust client-submitted data); prevent fraudulent claims of ownership during seller verification (identity/document fraud risk); rate-limit and validate whitelisting API calls to avoid abuse (e.g., someone whitelisting a channel they don't own).
- **Compliance:** GST invoicing and e-invoicing rules for B2B transactions; marketplace TCS (Tax Collected at Source) obligations under Indian GST law if the platform is treated as an e-commerce operator; copyright law compliance (the whole point of the product, so rights-verification accuracy is a legal-exposure-critical path); data retention policy for dispute-relevant records (licenses, chat logs, whitelisting requests) to support legal defense if a dispute escalates beyond the platform.
- **Payments:** PCI scope should be minimized by using a gateway's hosted checkout/tokenization rather than handling card data directly; currency appears to be INR-only given UPI/Netbanking (no multi-currency mentioned, but Commercial/Broadcast tier implies potential international buyers — ambiguous).
- **Scalability:** catalog size and concurrent streaming load are unspecified; "seamless streaming" implies CDN-backed delivery that scales independently of the app server; whitelisting API calls to YouTube/Meta may be rate-limited externally and need queuing/retry logic.
- **Auditability:** verification hash + public verify link must be tamper-evident and durable (e.g., licenses must remain verifiable even if the underlying track is later delisted or disputed); admin verification decisions and dispute resolutions should be logged with reviewer identity and timestamp for legal audit trail.
- **Performance:** "instant" fulfillment (certificate, invoice, whitelisting) sets an implicit SLA — but whitelisting depends on external API latency (YouTube/Meta), which the platform doesn't control, so "instant" may only be achievable for certificate/invoice generation, with whitelisting following asynchronously. This gap should be surfaced to the product owner (see Open Questions).

---

## 7. Explicit assumptions

- **ASSUMPTION:** Pricing is single-currency INR, given UPI/Card/Netbanking as the only payment methods listed.
- **ASSUMPTION:** Sellers must complete individual KYC (identity + bank account verification) before receiving payouts, even though the PRD doesn't mention a KYC step.
- **ASSUMPTION:** "Splits" in the seller royalty ledger implies multiple rightsholders can be attached to one track, with percentage-based revenue splitting — no UI/flow for configuring splits is described in the PRD, so this is inferred from the word "splits" alone.
- **ASSUMPTION:** The watermark applied in the player (Module 2) is for preview/streaming protection only, and is distinct from whatever (if anything) is delivered to the buyer as "proof" — the PRD does not say a buyer receives an audio file at all, only a PDF certificate; it's assumed the buyer is expected to use the track directly from the platform's protected stream or is granted a non-watermarked download, but this is unresolved (see Open Questions).
- **ASSUMPTION:** License tiers are non-exclusive by default (same track can be licensed to many buyers at the same or different tiers simultaneously), since the PRD lists tiers as parallel options rather than describing exclusivity/availability locking.
- **ASSUMPTION:** Admin verification happens once per track at upload, not per-sale.
- **ASSUMPTION:** Platform commission is a configurable percentage taken at the transaction level before crediting seller royalty balance (inferred from "platform commissions" in Admin's responsibilities; no rate or mechanism given).
- **ASSUMPTION:** GST invoices are issued for Brand and Agency purchases (B2B); Creator/Personal purchases are treated as B2C and may or may not carry a formal GST invoice — PRD only explicitly ties GST invoices to the Brand role.
- **ASSUMPTION:** The "verify" public page at `platform.com/verify/{license_id}` exposes only non-sensitive license metadata (track title, licensee name, tier, status) and not financial or contact details.

---

## 8. Open questions

1. Has the platform secured, or does it plan to secure, formal partner access to the YouTube Content ID API and Meta Rights Manager API? Both are invite-only/partnership programs, not self-serve APIs — what is the fallback MVP behavior (e.g., manual whitelisting process) if that access is not yet granted?
2. What audio watermarking approach will be used — a forensic/inaudible watermarking vendor (enables leak tracing) or a simpler audible deterrent — and does the buyer ever receive an unwatermarked audio file, or only a certificate referencing the platform-hosted stream?
3. When a track has multiple rightsholders, how are royalty splits configured and enforced (who sets the percentages, can they be disputed, are they visible to buyers)?
4. If Admin verification rejects a track, what is the seller-facing process — resubmission flow, appeal, permanent rejection, and is any reason/feedback required to be given?
5. Are licenses exclusive or non-exclusive — can the same track be sold under the same tier to multiple different buyers at the same time, or does a purchase reduce availability for others?
6. Do licenses expire, or are they perpetual for the licensed use case? If they expire, what happens to already-published content when a license lapses?
7. What is the refund policy if a buyer's video is rejected by the platform/by YouTube or Meta, or if the buyer simply doesn't use the license?
8. If a whitelisted video still receives a copyright strike or ad block despite correct licensing and whitelisting, who is liable to the buyer (platform, label, or neither), and does the platform offer any compensation/guarantee?
9. What is the minimum viable set of languages and genres for MVP catalog scope (the PRD names Hindi, Punjabi, Tamil, English "etc." — is that the full initial scope or just examples)?
10. For Agency workspace billing, is invoicing consolidated into a single agency-level invoice, or itemized per client (relevant to GST compliance and client-facing transparency)?
11. Is the platform India-only for MVP (implied by UPI/GST/regional languages), or does it need to support international buyers/sellers (and if so, what currency/tax handling)?
12. What specific documentation is required/accepted as proof of ownership during seller verification, and who is legally liable if a seller submits fraudulent ownership documents that later get licensed out?
13. What exactly does "whitelisting" register — a buyer's entire channel/ad account, or only the specific video/ad creative — and does the buyer submit the video URL before or after publishing?
14. What is the escalation path and accountability if a dispute is not resolved within the 24–48 hour SLA?
15. Does a Creator/Personal purchase receive a GST invoice (B2C), or only a certificate — and does that affect the platform's own tax/TCS obligations as a marketplace facilitator?

---

*Analysis complete. 15 open questions identified across API access, legal liability, data model gaps, and scope boundaries.*
