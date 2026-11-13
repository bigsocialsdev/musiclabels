# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Five roles, one product (source: `docs/PRD.md`, `docs/PLAN.md`):

- **Creator / influencer (lead storefront audience, confirmed 2026-11-13).** Reel makers, vloggers, YouTubers in India. Buys a single-video organic license, often on a phone, often minutes before publishing. Job: find a track that fits by mood/genre/language, hear it, pay by UPI, get a certificate that protects the channel.
- **Commercial brand.** D2C, marketing and growth teams. Buys Brand Organic (≤3 videos) and Paid Ad (12-month) licenses; needs GST invoices with GSTIN, ad-account/channel registration and compliance paperwork.
- **Advertising agency.** Buys on behalf of named clients (`client_name` on the order; no multi-client workspace in MVP). Needs to filter licenses by client and hand certificates to clients.
- **Seller: independent artist or regional label.** Artists self-onboard (KYC, PAN, bank, seller agreement) and upload; labels are onboarded by concierge bulk import. Job: get tracks approved, answer clearance requests within 1 business day, watch sales and monthly payouts.
- **Platform admin.** Internal verification, clearance, disputes, finance and superadmin staff. Works queues all day in the admin console (PLAN §9): verification, concierge import, clearance, disputes, complaints, refunds, payouts, reconciliation, catalog, legal docs, users/orgs, enquiries, audit log. MFA-gated.

## Product Purpose

An India-only sync-licensing storefront for a curated, claim-safe catalog with a human clearance desk. Buyers purchase single-track, usage-based licenses in one checkout and receive a PDF certificate, a public verify page and a GST invoice. Success: a creator goes from "need a track" to licensed and publishing in minutes, and when a claim happens it gets resolved through a tracked process.

## Positioning

The platform is the **principal sub-licensor**: it sells every license and issues every GST invoice in its own name, then pays sellers a royalty. Only Class A (unregistered in fingerprint systems) and Class B (seller controls registration and contractually commits to releases) tracks are listed, every upload is screened, and clearance is a tracked human workflow with a dispute kit. The verifiable license record (`/verify/{public_id}`, record hash) is the proof object.

## Operating Context

- Buyers: discovery (faceted search by genre, mood, language incl. Instrumental, BPM, price level, tier availability, duration), waveform preview with an audible watermark, track page with tier picker, single-track checkout via Razorpay (UPI/Card/Netbanking), buyer dashboard (licenses, channel bio-code verification, video registration, downloads, invoices/credit notes, disputes).
- Sellers: onboarding, upload, track list/detail, rejection + resubmit, versions, delist, sales table, payout statements, CSV export, clearance-request inbox.
- Admin: queue-based console with ageing, due dates, evidence, audit trail, TOTP-gated approvals.
- Documents are first-class artifacts: license certificate PDF with QR, dispute kit PDF, tax invoices `MRM/26-27/000123`, credit notes, payout statements.

## Capabilities and Constraints

- Stack fixed: Next.js 16 App Router, React 19.2, Tailwind v4 (CSS config in `app/globals.css`), shadcn/ui (new-york, neutral base, CSS variables) on Radix, Lucide icons, next-themes, Chart.js. Design must layer on shadcn, not replace it.
- License tiers: Creator (1 video, perpetual), Brand Organic (3 videos, perpetual), Paid Ad (12 months), Commercial/Broadcast (enquiry form only).
- Prices in INR, integer paise, GST-exclusive price book; checkout shows taxable value, GST lines and total.
- MVP scope: single-track checkout (no cart, coupons, upgrades), email-only notifications, English UI, INR only.
- Audible preview watermark only; no Content ID/Rights Manager integration.
- **Undecided:** product name and logo (placeholder working name until decided).

## Brand Commitments

- No committed name, logo or palette yet (confirmed 2026-11-13).
- Copy describes clearance as a process; never promise "zero strikes", "instant protection" or guaranteed outcomes (root `CLAUDE.md`).

## Evidence on Hand

- No real catalog content: no cover art, artist photos or confirmed artists (confirmed 2026-11-13). The storefront must stand on metadata and waveforms alone. Do not fabricate artists, testimonials, customer logos, sales numbers or press.
- Real legal/process facts available for copy: tier rules (PLAN §6.1), certificate and verify-page fields (PLAN §7), GST and invoice formats (PLAN §8).

## Product Principles

1. **Proof over promise.** Every license is a verifiable record; show the record, the process and its status rather than reassurance.
2. **Minutes for creators, paperwork for businesses.** The same flow serves a creator in a hurry and a brand that needs GSTIN, invoices and client names; detail appears when the buyer needs it.
3. **The track is the product.** Discovery is about hearing and comparing audio fast; everything else supports that.
4. **Operators work queues.** Seller and admin surfaces are measured by how quickly a status, due date or next action can be read and acted on.
5. **Money and legal facts are exact.** Amounts, tax lines, IDs and statuses are shown precisely and never decoratively.

## Accessibility & Inclusion

- WCAG 2.1 AA target, axe zero serious violations on key pages (PLAN S4-M11).
- Player must work on mobile and by keyboard (PLAN S4-M8).
- Indian mobile-first buyers: assume mid-range Android phones and variable networks for the storefront.
