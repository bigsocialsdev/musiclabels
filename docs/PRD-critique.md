# PRD Critique — Music Rights Marketplace (Simple Core Edition)

Inputs: `docs/PRD.md`, `docs/PRD-analysis.md`, and the 15 working assumptions in `docs/STATE.md` (referred to below as A1–A15). The assumptions are treated as an unreviewed baseline, not as settled fact.

Legal and tax points below are an architect's reading, not professional advice. Items marked **[CA]** or **[Lawyer]** need sign-off from a chartered accountant or an IP/fintech lawyer before Phase 3 locks the design. A short list of what was checked against public sources is at the end.

## Bottom line

1. **The core promise is not buildable as written.** "API whitelisting with YouTube Content ID and Meta Rights Manager" assumes the platform is the party making the claims. It is not. Claims on a buyer's video come from whoever registered the track's fingerprint, which is the seller's label or distributor. The platform can only release claims it or a contracted partner controls.
2. **A1's "manual whitelisting fallback" is not a fallback.** Without Content Manager access there is nothing for an admin to whitelist against. The real fallback is a catalog policy plus seller-side release commitments.
3. **A13 models a primitive that does not exist.** YouTube's allowlist is per channel across a content owner's whole catalog, not per channel per track.
4. **The principal-versus-agent question is undecided and drives everything financial.** Invoicing, TCS, payout architecture, RBI exposure and liability all flip on it. A15 answers a narrower question and gets the framing wrong.
5. **The MVP should be a licensing storefront with a curated, claim-safe catalog and a human clearance desk.** Roughly half of the PRD's automation should be cut.

---

## 1. Gaps

Requirements the PRD implies but leaves unspecified, where the working assumptions do not resolve them or resolve them too thinly to build.

**G1. Who holds the fingerprint registration for each track.** Neither the PRD, the analysis, nor A1 asks whether a seller's track is already in Content ID or Meta's fingerprinting through a distributor or label CMS. This single fact decides whether a buyer will ever see a claim and who can release it. It must be a mandatory, verified field on every track.

**G2. Master versus composition rights.** A sync licence needs both the sound recording and the underlying music and lyrics. The PRD treats "ownership" as one thing, and A12 inherits that. Unaddressed cases: covers, remixes, samples and loop-pack content, non-exclusively leased beats, traditional or devotional compositions, AI-generated tracks, IPRS-member composers (whose performance royalties on TV, OTT and cinema use are collected separately and cannot be cleared by this licence), and composition claims from a publisher that fire even when the master is cleared. **[Lawyer]**

**G3. Co-owner consent.** A3 records co-rightsholder names and percentages but not their consent. Under Indian law a joint owner generally cannot license without the other owners' agreement. A split table with no consent record documents the platform's knowledge of the problem without solving it. **[Lawyer]**

**G4. Pricing and commission.** None of the 15 assumptions covers this (analysis §2 Module 1 and Module 3 ambiguities). Open: who sets the price per tier, floors and ceilings, whether sellers opt in per tier, the commission rate, whether prices are GST-inclusive, and how a price change affects past licences.

**G5. Mapping seller usage flags to tiers.** Sellers flag "organic social, paid ads, cuts/edits"; buyers choose among four tiers. "Cuts/edits" is a modification right, not a channel, and there is no flag for broadcast. The mapping is undefined (analysis §2 Module 1).

**G6. The licence itself.** The PRD specifies a certificate but no licence terms. Each tier needs a legal text covering term, territory, media, modification rights, attribution, transferability, and sub-licensing from agency to client. The certificate is evidence of that text, not a substitute.

**G7. Definition of "a video."** The tiers cap usage at 1 or 3 videos. Undefined: whether cross-posting one edit to YouTube, Instagram and Facebook counts as one or three; cut-downs (30s, 15s, 6s); aspect-ratio and language variants; re-uploads. A13 then removes the only mechanism that could count videos (see C2).

**G8. Creator tier boundary.** "Organic only" does not say whether a monetised YouTube channel qualifies, or whether a sponsored reel for a brand falls under Creator or Brand. Influencers are the stated target and most of their income is sponsored content. Brand boosting a creator's post is also unplaced. This is a pricing-arbitrage hole: brands will buy Creator licences through creators.

**G9. Channel ownership proof.** A13 has the buyer type a handle at checkout. Nothing verifies that the buyer controls it (analysis §6 flags this; no assumption resolves it). Also unspecified: handle changes, adding a second channel, removing a channel on refund or revocation.

**G10. What "whitelisting" means for ad accounts, OTT, TV and cinema.** Fingerprint systems match uploaded media on a channel, Page or profile. Ad account IDs are not something they match on, and OTT pre-roll, TV and cinema have no fingerprint gate at all. For those channels the product is a contract and paperwork (clearance letter, cue sheet), which the PRD does not describe.

**G11. Clean-file delivery.** A2 correctly adds a clean download, but not its specification: formats, whether stems or edits are offered, signed and expiring URLs, download limits, and what happens on a chargeback after the file is taken.

**G12. Fulfilment failure states.** "Instant" fulfilment has at least five steps with independent failure modes. No order state machine, no idempotency rule for payment webhooks, no definition of what the buyer sees when the certificate is issued but clearance is pending (analysis §2 Module 4 raises this; A1 does not answer it).

**G13. Funding refunds and clawbacks.** A7 refunds the buyer when rights turn out to be invalid. By then the seller may have withdrawn the money. There is no payout hold, reserve or clawback mechanism.

**G14. Denied disputes and licence breach.** Analysis §2 Module 5 asks what happens when the claim is valid because the buyer exceeded scope. A14 covers only SLA escalation. No denial flow, no breach process, no monitoring.

**G15. Seller exit.** Not covered: a seller delisting a track, moving it to a distributor that turns on Content ID, or selling the catalog. Each breaks existing perpetual licences in practice.

**G16. Agency "creator permissions."** Analysis §4.6 flags the phrase as unclear. No assumption addresses it. It probably means authorising named creator handles under a brand's licence, which is a real feature with its own data model.

**G17. Label onboarding.** A one-track upload form does not serve a label with thousands of tracks. Bulk ingestion and contract-based onboarding are absent.

**G18. Verify-page privacy.** The public page shows the licensee name. For individual creators that is personal data published at a guessable URL pattern. Licence ID entropy and enumeration protection are unspecified. "Cryptographic verification hash" is also undefined: hash of what, signed by what key, verified by whom.

**G19. Smaller holes.** "Media type" search facet is undefined. "Out of budget" has no budget input. Instrumental tracks have no value in a four-language list (A9).

---

## 2. Contradictions

**C1. "Instant channel protection" versus A1.** The PRD promises instant protection and "automated fulfilment" that "updates YouTube/Meta whitelists." A1 makes this manual and dependent on access the platform does not have. The Creator persona's headline benefit is therefore false at launch. The product copy and the certificate must not claim protection the system cannot deliver.

**C2. A13 versus the tier caps.** Channel-level clearance submitted before publishing cannot enforce "1 video" or "up to 3 videos." The `License` entity has no record of which videos use it, while `Dispute` requires a video URL. The data model is missing a licensed-use (video) entity, and A13 prevents one.

**C3. A13 versus how Content ID works.** A13 says whitelisting is "per-channel, scoped to the licensed track." YouTube's allowlist exempts a channel from all of a content owner's assets; individual assets cannot be allowlisted. A channel-level allowlist therefore hands a one-track buyer free use of that owner's entire catalog, indefinitely. Per-track, per-video licensing needs per-video claim release instead.

**C4. "Zero copyright strikes" versus A8.** PRD step 5 promises verified rights and zero strikes. A8 limits the platform to best effort with no compensation. For consumer buyers this gap between advertised outcome and contract terms is a misleading-advertising and unfair-terms risk under the Consumer Protection Act 2019. **[Lawyer]** The PRD also conflates Content ID claims (monetisation diverted, video blocked or muted) with copyright strikes (legal takedowns that threaten the channel). They have different processes and timelines.

**C5. A6 (perpetual) versus A6 (revocable) versus reality.** Licences are "perpetual" but revocable by admin, depend on a seller who may leave (G15), and may be granted by sellers whose own rights are term-limited. A label holding a five-year licence from an artist cannot grant a perpetual sub-licence. Perpetual clearance is also an unfunded, indefinite operational obligation paid for by a one-time fee.

**C6. A7 versus A12.** A12 puts fraud liability on the seller through indemnity. A7 calls later-discovered invalid rights a "platform-caused error" and refunds from the platform. Both cannot be the operating rule, and neither says where the money comes from (G13).

**C7. A3 versus the PRD's "transparent royalty ledger showing splits."** A3 displays splits that total 100% and then pays 100% to one party. The analysis's `RightsholderSplit` entity carries a `user_id`, implying co-owners are account holders who can see what they are owed and not paid.

**C8. "Direct payouts" versus a withdrawable royalty balance.** The PRD says sellers receive direct payouts, then describes a ledger balance with bank withdrawals. A platform that holds sellers' sale proceeds and releases them on request is handling third-party funds (see §5.4).

**C9. A15 versus the invoice model.** PRD step 4 issues "the GST invoice," singular, and the analysis has `Transaction 1—1 Invoice`. In a marketplace there are two supplies: seller to buyer (the licence) and platform to seller (the commission). `Transaction 1—N License` across multiple sellers means several supplier invoices per order. A15's "all tiers receive a GST-compliant invoice" also cannot hold when the seller is unregistered (see §5.5).

**C10. A10 versus GST timing and the licensee of record.** A consolidated invoice per workspace does not fit prepaid, pay-at-checkout orders: a tax invoice is due per supply. Consolidated periodic invoicing implies credit terms, which the PRD's instant checkout does not have. Separately, the certificate names the client brand as licensee while the invoice names the agency; the licence text must explicitly allow purchase on behalf of a named client.

**C11. A5 (non-exclusive) versus the Commercial/Broadcast tier.** Brands buying music for TV and cinema campaigns commonly expect category or term exclusivity. A self-serve non-exclusive licence at that tier will not meet buyer expectations, and the seller may sell the same track to a competitor the next day.

**C12. A5 (non-exclusive) versus Content ID eligibility.** Content ID requires the claimant to hold exclusive rights. A seller listing non-exclusively here and elsewhere, possibly with the track at several distributors, produces multiple or conflicting claimants. The more open the catalog, the less clearable it is.

**C13. A11 (India-only) versus global platforms.** Buyers and sellers may be Indian, but YouTube and Instagram distribution is worldwide. The licence territory must be worldwide for online use, while sellers' rights and Content ID ownership are per territory. The `License` entity has no territory field.

**C14. A1's "API path wired but dormant."** Writing an integration against an API the team cannot call or test produces untested dead code. This contradicts the owner's own preference for the simplest working solution.

**C15. Admin "issues automated releases."** The PRD has admins manually triggering something it calls automated, within an SLA governed by third parties. The SLA clock is defined on an outcome the platform does not control (see §5.6).

---

## 3. Risky assumptions

Ranked by the damage done if built on without validation.

| Rank | Assumption | Risk type | Why it is dangerous | What to do instead |
|---|---|---|---|---|
| 1 | **A1** Content ID / Rights Manager adapter plus manual fallback | Business, technical | Treats partner access as a timing issue. A startup that owns no catalog and holds no exclusive rights does not meet the eligibility test at all. The "manual fallback" has no tool to operate. The product's main differentiator rests on this. | Drop the adapter. Gate the catalog by clearability and put release obligations on sellers (§5.1). |
| 2 | **A13** Per-channel whitelisting scoped to a track, pre-publication | Technical, commercial | Not a real primitive on YouTube. Channel allowlisting gives away the content owner's catalog and cannot enforce video caps. | Register channel at checkout, register each video URL after upload, release claims per video. |
| 3 | **A15** GST invoice and TCS for all tiers | Tax, architectural | Correct that TCS does not depend on buyer type, but it skips the real decision (principal or agent) and promises invoices the platform cannot issue for unregistered sellers. Getting this wrong means rebuilding invoicing and payouts. | Decide the supply model first. Recommended: platform as principal sub-licensor (§5.5). **[CA]** |
| 4 | **A12** Self-declaration plus one document plus indemnity | Legal | Indemnity from an individual artist is worth little when a major label sues. The platform reviews, approves, prices and certifies, so intermediary safe harbour is unlikely to apply. One fraudulent upload of a major-label song, licensed to a brand for paid ads, is an existential event. | Add fingerprint screening against commercial catalogs, a claim probe, a payout hold, and concierge onboarding for the launch catalog. **[Lawyer]** |
| 5 | **A3** Splits recorded, primary seller paid | Legal, trust | Records co-ownership, pays one party, captures no consent. Creates evidence against the platform in any co-owner dispute. | One payee per track, with a warranty that the payee holds all co-owners' consent and pays them. No split UI in MVP. |
| 6 | **A6** Perpetual, no expiry | Legal, commercial | Conflicts with term-limited seller rights and seller exit. Indian copyright law deems an unstated term to be five years, so "perpetual" must be express. Paid-ad sync is normally priced by term; perpetual ad rights will put labels off. | Organic tiers: perpetual for the registered videos. Paid ad tier: fixed 12-month term, renewable. **[Lawyer]** |
| 7 | **A8 / A7** No compensation; no refunds | Commercial, consumer law | Brand legal teams will not accept music for paid campaigns with no IP indemnity. "No refund" when clearance fails is hard to defend for consumers. | Refund when a claim from the catalogued rightsholder is not released within a fixed window. Liability capped at fees paid. Funded by the payout hold. |
| 8 | **A10** Consolidated agency invoice | Tax | Does not fit prepaid checkout (C10). | Per-order invoices tagged with client name; monthly statement as a non-tax document. |
| 9 | **A2** Audible watermark, clean file after checkout | Fraud | Right call. Residual risk is download-then-chargeback and the missing delivery spec (G11). | Keep. Add signed URLs and hold payouts past the chargeback window. |

**Acceptable as they stand:** A4 (rejection with reason), A5 (non-exclusive, subject to C11), A9 (four languages; add "Instrumental"), A11 (India-only buyers and sellers; fix territory per C13), A14 (escalation; reword the SLA per §5.6).

---

## 4. Missing requirements

Things a real marketplace of this kind needs that neither the PRD nor the analysis specifies.

**Identity and access**
- Authentication for every role: email verification, OTP or password policy, session management, password reset, and mandatory 2FA for admins and for sellers before changing payout details.
- Role-based access within an organisation (label staff, agency staff), with invitations and removal.
- Channel ownership verification through Google and Meta sign-in rather than typed handles.

**Legal consent and audit trail**
- Versioned Terms of Service, seller agreement, and per-tier licence text, with acceptance recorded per user, version, timestamp and IP.
- Each licence must pin the exact licence-text version and price in force at purchase.
- Immutable audit log of admin actions: verification decisions, revocations, refunds, payout approvals, manual overrides.

**Catalog integrity and moderation**
- Fingerprint screening of every upload against commercial music databases to catch uploads of someone else's release.
- Duplicate detection across sellers.
- Content moderation beyond rights: hate speech, obscenity, defamatory or politically sensitive lyrics, and a policy on AI-generated music and voice clones.
- Copyright complaint and takedown procedure for third parties claiming a listed track, with a designated grievance officer. **[Lawyer]**

**Seller lifecycle**
- Delisting rules: existing licences survive; seller remains bound to keep clearing them; successors are bound on catalog sale.
- Track replacement and versioning: replacing audio creates a new version; old licences reference the old one.
- Account closure, suspension, and what happens to unpaid balances.

**Pricing and licence versioning**
- Price history per track and tier; tier definitions versioned over time.
- Credit notes for refunds; invoice numbering that survives cancellations.

**Buyer usage**
- Video registration against a licence, with cap enforcement.
- Licence transfer or correction (wrong channel entered), with limits.
- Re-download of certificate, invoice and audio.

**Admin tooling**
- Verification queue with workload and turnaround tracking.
- Clearance queue (requests to sellers to release or allowlist) with ageing.
- Dispute queue, refund tool, licence revocation tool, payout approval, reconciliation view, user impersonation with audit.
- None of this is in the PRD, and it is the majority of the operational surface.

**Support and communications**
- Support channel or ticketing for buyers and sellers outside the dispute form.
- Transactional notifications (email at minimum) for every state change; delivery tracking.

**Discovery**
- Search ranking rules (relevance, recency, sales), not just filters.
- Indexable public track pages, metadata and sitemaps; previews that play without login.
- Abuse-resistant preview streaming: signed URLs, no direct file paths.

**Front-end quality**
- Mobile-first responsive design; the Creator audience is on phones.
- Accessibility to WCAG 2.1 AA, including the audio player.
- Internationalisation readiness: externalised strings, locale-aware currency and dates, Unicode-safe search for Indic scripts and transliteration, even if the UI ships in English only.

**Abuse prevention**
- Rate limits on uploads, sign-ups, preview streams, the verify page and checkout.
- Upload validation: format, duration, size, malware scan on documents.
- Fake-seller and stolen-card fraud checks; velocity limits on payouts.

**Data protection and security**
- Compliance with the Digital Personal Data Protection Act 2023 and its rules: notice, consent, retention, deletion, breach notification. KYC documents and bank details need encrypted storage and restricted access. **[Lawyer]**
- Master files in private storage; access only through short-lived signed URLs.

**Finance operations**
- Daily reconciliation of gateway settlements against orders.
- TDS deduction and certificates, GST returns, and year-end statements for sellers. **[CA]**
- Chargeback handling.

**Analytics**
- Seller reporting: plays, conversion, sales by tier, payout statements, CSV export.
- Agency reporting by client.
- Platform metrics: verification turnaround, clearance turnaround, dispute rate per seller.

**Operations**
- Backups with tested restore for the database and the master-audio store; stated RPO and RTO.
- Licence records and the verify page must outlive any single track, seller or vendor.
- Monitoring and alerting on payment webhooks and fulfilment jobs.

---

## 5. Legal and technical feasibility risks

### 5.1 YouTube Content ID access

**Verdict: not obtainable directly for the MVP, and probably not within the first one to two years. Plan as if it will never be granted directly.**

- YouTube's published test is exclusive rights to a substantial body of original material that the YouTube community uploads frequently. There is no numeric threshold; approval is at YouTube's discretion, and most applicants are steered to weaker tools.
- A new non-exclusive marketplace fails twice: it has no catalog history, and as a non-exclusive sales channel it holds no exclusive rights to anything. Meeting the test would require sellers to grant the platform exclusive Content ID administration, which collides with their existing distributor deals.
- The Content ID API is available only to approved content partners. There is no sandbox for anyone else.
- Even with access, the allowlist is per channel, applies to future uploads only, and covers the owner's whole catalog. Where several partners own shares of an asset, each must allowlist separately. It does not fit per-track, per-video licences (C3).
- The claims buyers will actually receive come from the seller's label or distributor, or from a composition publisher. Platform access would not release those.

**Intermediary route (post-MVP).** Become a client of a company that already has a Content Manager and offers allowlisting to licensing businesses: rights-management and distribution firms such as AdRev, Identifyy, SourceAudio, Believe, Symphonic or The Orchard, or an India-based CMS holder such as Divo. Expect a revenue share on claim income, a requirement for exclusive Content ID rights on every delivered track, and rejection of leased beats, sample-based and cover material. Commercial terms and appetite are unverified; this is a business-development workstream of months, not an engineering task.

**MVP fallback (recommended).**
1. Classify every track at onboarding. **Class A**: not registered in any fingerprint system. **Class B**: registered, and the seller controls the registration (own CMS, or can instruct its distributor) and signs a release commitment with a named operations contact. **Class C**: registered with a third party and no release path. Reject Class C.
2. Verify the classification with a claim probe: an admin uploads the track in a private video on a platform-owned test channel and records which claims fire and from whom.
3. For Class B sales, send the seller a clearance request containing the buyer's channel and, once uploaded, the video URL. Track turnaround per seller. Delist sellers who miss it.
4. Tell buyers to upload as private or unlisted first. YouTube's upload checks surface claims before the video goes public, so they can be released before launch.
5. Give every buyer a dispute kit: certificate, licence text and suggested dispute wording, so the buyer can file the platform-side dispute in parallel.

### 5.2 Meta Rights Manager access

**Verdict: same gate, with less API surface and a separate track for music. Do not plan on direct access.**

- Rights Manager is application-based and granted per Page after Meta reviews the applicant's rights and catalog. A Rights Manager API exists for approved rights holders only.
- Music is handled largely through distributor and label deliveries into Meta's music fingerprinting and audio library feeds, not by individual marketplaces. Whether a non-label marketplace can submit music-only reference files should be assumed "no" until Meta says otherwise. (Not confirmed from Meta's own pages; treat as a working assumption.)
- Allowlisting, where available, is by Page, profile or Instagram account. Ad account IDs are not a matching key. An ad is cleared by clearing the Page or account that publishes the creative.
- Paid ads add a second gate the rights holder does not control: Meta's ad review. A licensed ad can still be rejected or muted and must be appealed by the advertiser.
- Meta's own in-app music library is restricted for commercial use, which is the market opening for this product. It also means brands arrive expecting the platform to solve the problem end to end.

**MVP fallback.** Identical to §5.1: Class A and Class B catalog only; clearance requests routed to the seller's label or distributor, who allowlists the buyer's Page or account; dispute kit for the buyer. For the paid-ad tier, state plainly in the licence that ad review outcomes are outside the platform's control.

### 5.3 Audio watermarking

**Verdict: A2 is right. Cut forensic watermarking permanently, not just for MVP.**

- **Audible watermark.** A spoken or tonal tag mixed into a low-bitrate preview, rendered once at ingest with a standard open-source audio tool and stored as a separate file. Cost is negligible and it needs no vendor. This is what stock-music sites do.
- **Forensic watermark.** Inaudible, per-session or per-buyer marks need either real-time embedding or pre-rendered variant segments switched per listener. Vendors sell this to studios and pre-release music services on enterprise contracts. It is priced and engineered for content whose leak value is high.
- **Why it buys nothing here.** The licensed use of the product is to publish the track publicly inside a video. Anyone can extract the audio from any buyer's published video. Tracing a preview stream or a download protects nothing that is not already exposed.
- **The PRD's stated purpose is wrong.** No watermark "prevents unauthorised recording." It deters casual use of the preview. Reword the requirement.
- **What does matter.** Keep masters in private storage, serve previews and purchases through short-lived signed URLs, and never expose a direct file path.
- **One usability point.** Agencies cut rough edits before buying. Allow download of the watermarked preview for that purpose.

### 5.4 Payment splits and payouts

**Verdict: feasible, but only in two shapes. The shape the PRD describes (platform holds seller balances, sellers withdraw) is the one to avoid.**

- **Regulation.** Collecting buyers' money on behalf of sellers and settling it to them is payment aggregation. Under the RBI's Payment Aggregator directions (consolidated in September 2025), a non-bank aggregator needs RBI authorisation, net worth of Rs 15 crore at application rising to Rs 25 crore, and must hold merchant funds in escrow with a scheduled commercial bank. The old nodal-account arrangement for intermediaries has been replaced by this regime. A startup marketplace cannot do this itself. **[Lawyer]**
- **Shape 1: marketplace with a licensed aggregator's split settlement.** The gateway holds funds in its own escrow and settles each seller's share to that seller's bank account. Each seller is onboarded as a sub-merchant and KYC'd by the gateway. Splitting one payment across several rightsholders is technically simple in this shape, but every payee needs full onboarding, and reversing a settled split after a refund is awkward. The "royalty balance" becomes a display of scheduled settlements, not a wallet.
- **Shape 2: platform as principal.** The buyer pays the platform for the platform's own supply. The seller's share is a contractual royalty the platform owes, paid in batches through a payout product or bank bulk transfer. No third-party funds are held, so the aggregator question does not arise. This is the recommended shape and matches §5.5.
- **KYC for payouts in either shape.** PAN (needed for tax deduction), bank account verification by test credit with name match, GSTIN where registered, and company documents plus authorised signatory for labels. Decide how to handle sellers under 18.
- **Tax at payout.** Marketplace shape: income-tax deduction on e-commerce participants (0.1%; the former section 194-O, now under section 393 of the Income-tax Act 2025). Principal shape: deduction on royalty payments (the former section 194J; rate and threshold to be confirmed). **[CA]**
- **Payout timing.** Replace on-demand withdrawal with a monthly cycle and a hold of at least 30 days. The hold funds refunds and chargebacks and gives time for fraud to surface (G13).
- **Multi-rightsholder splits.** Do not build. The legal problem is consent (G3), not arithmetic.
- **Never** allow a seller balance to be spent on purchases. That moves toward prepaid-instrument regulation.

### 5.5 GST invoicing

**Verdict: A15 is half right for the wrong reason, and it answers the wrong question.**

What A15 gets right:
- TCS under section 52 does not depend on whether the buyer is a business or a consumer.
- A registered supplier must issue a tax invoice to consumers too (with a narrow exception for very small values). So if the supplier is registered, Creator purchases do get a GST invoice.

What A15 gets wrong or omits:
- **TCS is a seller-side mechanism.** The operator collects it (0.5% of net taxable value since July 2024) on supplies made by other suppliers through the platform where the operator collects the money. It has no bearing on which buyers receive invoices.
- **In a marketplace, the licence invoice is the seller's invoice.** The platform's own invoice covers only its commission and goes to the seller. Most independent artists will be below the GST registration threshold and unregistered. An unregistered seller charges no GST and cannot issue a tax invoice, and the brand gets no input tax credit. "All tiers receive a GST-compliant invoice" is therefore undeliverable for a large part of the catalog, and the PRD's promise to brands breaks. Whether unregistered service suppliers on a TCS-collecting platform keep the threshold exemption should be confirmed. **[CA]**
- **"Creator invoices marked B2C" is not a compliance concept.** A consumer invoice is simply one without a recipient GSTIN. It must still capture the buyer's state to determine place of supply and the IGST or CGST/SGST split. E-invoicing applies only to business-to-business invoices above a turnover threshold.
- **The marketplace model carries overhead.** Compulsory registration as an e-commerce operator regardless of turnover, a monthly TCS return, and probably TCS registrations in each state where sellers are located. **[CA]**

**The actual decision: is the platform a marketplace or the licensor?**

| | Marketplace (agent) | Principal (sub-licensor) |
|---|---|---|
| Who supplies the licence | Seller | Platform |
| Invoice to buyer | Seller's, generated by platform; none with GST if seller unregistered | Platform's, 18% GST on every sale |
| Input credit for brands | Only when seller is registered | Always |
| TCS and monthly TCS return | Yes | No |
| Payout architecture | Aggregator split settlement | Royalty payments from own funds |
| Tax at payout | 0.1% on e-commerce participants | Royalty withholding; possible reverse-charge GST on composer royalties |
| Platform GST turnover | Commission only | Full sale value |
| Liability to buyer | Contractually the seller's; in practice the platform's | The platform's |

**Recommendation: principal model.** Sellers grant the platform a non-exclusive, sub-licensable licence; the platform issues every licence and every invoice in its own name. It gives one invoice series, input credit for every business buyer, no TCS, and the simplest payout design. Its costs are GST on gross value, royalty withholding, and open acceptance of liability. That liability sits with the platform in practice anyway, because it verifies, prices and certifies each licence. The arrangement has to be real: if sellers set prices freely and the platform merely passes money through, the structure may be recharacterised. **[CA] [Lawyer]**

### 5.6 Copyright dispute handling and the 24–48 hour SLA

**Verdict: 24–48 hours is achievable only for claims made by a party under contract to the platform. As a blanket promise it is false.**

- **Release by the claimant is immediate** once the claimant acts. The whole SLA therefore reduces to how fast a Class B seller's operations contact responds. That is a contract term with the seller, not an API property.
- **Third-party claims are outside any SLA.** If the uploader disputes through YouTube, the claimant has 30 days to respond, and 7 days on appeal. Claims from an unrelated distributor, a composition publisher, or a fraudulent registrant follow those clocks.
- **Strikes are slower still.** A copyright strike from a takedown notice is cleared by the claimant retracting it or by a counter-notification, which takes roughly two weeks.
- **Meta.** Disputes go to the rights holder, who has days to respond. Ad rejections are reviewed by Meta alone. The platform has no lever on either beyond chasing the seller.
- **"Direct partner contacts"** at YouTube and Meta are given to large partners. A new entrant has none.
- **Paid campaigns lose money while a claim stands.** A 48-hour block on a live ad is a real loss, which is why brands will demand more than "best effort" (A8).

**Recommended SLA wording.**
- Platform commitment: first action within one business day (request sent to the rights holder, buyer told what was done).
- Resolution target of 48 hours for Class A and Class B tracks only, backed by the seller's contractual release obligation.
- Outside that: no time promise; buyer receives the dispute kit and a refund if the claim is not released within a fixed window.
- Report claims, strikes, mutes and ad rejections as separate dispute types.

---

## 6. Recommended scope cuts for an MVP

In priority order. Items 1–6 remove infeasible or legally exposed scope; the rest remove cost.

1. **Defer Content ID and Rights Manager API integration entirely, including the dormant adapter.** No access, no sandbox, and the allowlist primitive does not fit the licence model.
2. **Launch with a curated Class A and Class B catalog only; reject tracks whose fingerprint registration is controlled by an uncommitted third party.** Clearability is decided by the catalog, not by code.
3. **Replace "API whitelisting at checkout" with channel registration, post-upload video registration, a clearance request to the seller, and a buyer dispute kit.** This is the only process that works without partner access and it enforces the video caps.
4. **Remove the Commercial/Broadcast tier from self-serve checkout; make it an enquiry form.** TV, OTT and cinema need negotiated terms, exclusivity and performance-royalty paperwork that a checkout cannot express.
5. **Adopt the principal (sub-licensor) model with a single platform invoice; drop TCS, per-seller invoices and split settlement.** One invoice series and no third-party funds, pending CA and lawyer sign-off.
6. **Replace on-demand withdrawals with a monthly payout run and a 30-day hold.** Funds refunds and chargebacks and removes the wallet-like balance.
7. **Cut royalty splits completely, including the display-only split table in A3.** One payee per track with a co-owner consent warranty; a visible split with no payout creates liability and no value.
8. **Cut forensic watermarking; use an audible tag rendered once at ingest.** Published videos expose the audio anyway.
9. **Cut acoustic similarity; show "similar tracks" by genre, mood, BPM range and lower price.** A metadata query delivers the stated purpose without a machine-learning pipeline.
10. **Defer the agency multi-client workspace to V2; add a "client name" field on each order that prints on the certificate and invoice line.** Covers the agency's real need without a sub-tenant data model.
11. **Give the paid-ad tier a fixed 12-month term; keep perpetual only for registered organic videos.** Limits open-ended clearance obligations and matches how ad sync is priced.
12. **Single-track checkout only; no cart, no upgrades, no coupons, no exclusive licences.** Each removes a class of invoicing and state-machine edge cases; a second video means a second purchase.
13. **Replace the "cryptographic verification hash" with a long random licence ID, a server-side verify page and a QR code.** The server record is the source of truth; a printed hash adds nothing a lookup does not.
14. **Concierge onboarding for labels (admin-side bulk import); self-serve upload for individual artists only.** Labels sign contracts before listing anyway, and a bulk-ingestion product is a project of its own.
15. **Reword the dispute SLA to "first action within one business day"; build disputes as a form, an admin queue and email, with a due date and an overdue filter.** The platform cannot promise third-party outcomes and does not need an SLA engine to track a handful of cases.
16. **Seller analytics limited to a sales table, payout statement and CSV export.** Charts can wait for sellers with enough sales to chart.
17. **English-only UI, INR only, web only (responsive), email-only notifications.** Content languages stay as catalog metadata; everything else is post-launch.

**Do not cut:** fingerprint screening of uploads, versioned terms acceptance with audit trail, idempotent payment handling with a defined order state machine, the admin console (verification, clearance, dispute, refund, payout), backups, and a third-party copyright complaint process. These are what keep the first fraudulent upload or failed payment from ending the business.

### Decisions to force before Phase 3

1. Principal or marketplace (§5.5). Blocks invoicing, payments and the seller agreement.
2. Catalog policy: Class A and B only at launch (§5.1).
3. Licence term per tier and the definition of "a video" (G7, A6).
4. Refund and liability position for failed clearance (A7, A8).
5. Whether an intermediary Content ID partnership is pursued in parallel as business development.

---

## Verification notes

Checked against public sources while writing:
- YouTube Help, "Exempt channels from Content ID claims": allowlist is channel-only, not per asset; applies to future uploads; each owning partner must allowlist. https://support.google.com/youtube/answer/6070344
- YouTube Help, "How Content ID works": eligibility wording on exclusive rights and a substantial body of frequently uploaded material. https://support.google.com/youtube/answer/2797370
- YouTube Help, "Dispute a Content ID claim" and "Appeal a Content ID claim": 30-day dispute and 7-day appeal response windows. https://support.google.com/youtube/answer/2797454 and https://support.google.com/youtube/answer/12104471
- RBI (Regulation of Payment Aggregators) Directions, 15 September 2025: net-worth and escrow requirements, via press and law-firm summaries. https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=12896
- GST TCS rate of 0.5% from 10 July 2024 (Notification 15/2024-Central Tax), via secondary tax commentary.
- Income-tax Act 2025 in force from 1 April 2026 with deduction provisions consolidated under section 393, via secondary tax commentary; sources conflicted on the royalty threshold.

Not confirmed from primary sources and flagged in the text: Meta's treatment of music-only reference files from non-label applicants; state-wise TCS registration; the registration exemption for small service suppliers selling through an operator; royalty withholding rate and threshold; reverse charge on composer royalties; current terms of any named intermediary.
