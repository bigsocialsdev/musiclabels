# Technical Plan — Music Rights Marketplace (MVP)

Phase 3 (Architect) output. Inputs: `docs/STATE.md` (locked decisions), `docs/PRD-critique.md` (accepted in full), `docs/PRD-analysis.md`, `docs/PRD.md`. Where this plan and the raw PRD disagree, this plan follows the locked decisions. Items marked **[CA]** or **[Lawyer]** are values the code must hold as configuration until a professional confirms them; they do not block the build.

Conventions and non-negotiable invariants for the build sessions live in the root `CLAUDE.md`. This document is the "what and why"; `CLAUDE.md` is the "rules while building".

---

## 0. Product in one paragraph

A licensing storefront for a curated, claim-safe catalog with a human clearance desk. The platform is the **principal sub-licensor**: sellers (artists, labels) grant the platform a non-exclusive, sub-licensable right; the platform sells single-track, usage-based licenses to buyers in its own name, issues every GST invoice itself, and pays sellers a contractual royalty in a monthly payout run after a 30-day hold. Only Class A (unregistered in any fingerprint system) and Class B (seller-controlled registration plus a contractual release commitment) tracks are listed. There is no YouTube Content ID or Meta Rights Manager API integration; clearance is a tracked manual workflow against the seller, plus a buyer dispute kit, behind an adapter interface that a real integration can implement later. India-only: INR, GST, UPI/Card/Netbanking, Indian bank payouts.

---

## 1. Feasibility flags against locked decisions

Every locked decision in `docs/STATE.md` is buildable. F8 is a conflict between two recorded decisions, resolved in favour of the later one. The other items below are places where a decision is buildable only with a stated interpretation or an external dependency. None is a silent deviation; each needs owner confirmation at the Phase 3 gate.

| # | Locked decision | Issue | How this plan handles it |
|---|---|---|---|
| F1 | 48h resolution target for Class A/B tracks | A claim on a **Class A** track means someone *other than* the seller has registered it (misclassification or fraud). The seller cannot release it, so the target cannot be backed by the seller contract the way Class B is. | 48h target applies to both classes as locked. For Class A, "resolution" within 48h is defined as: claimant identified, seller notified, and either release obtained or the dispute moved to the refund track. **Definition accepted by owner 2026-11-12.** |
| F2 | Refund funded by 30-day seller payout hold | Licenses are perpetual (organic) or 12 months (paid ad). A claim in month 7 arrives after the seller's share has been paid out. The hold funds only early refunds. | Refund still issued by the platform (liability capped at fees paid). The seller's share is clawed back as a negative ledger entry netted against future royalties, backed by the seller-agreement indemnity. Residual uncollectable clawbacks are a platform loss, reported in admin. |
| F3 | Fingerprint screening on upload (do-not-cut) | Screening against commercial catalogs needs a paid vendor account (working choice: ACRCloud). That is a business dependency, not code. | `FingerprintScreener` interface with a vendor implementation and a test fake. If the vendor contract is not live at launch, every track routes to the admin claim probe (manual) and the review queue shows "screening unavailable"; publishing still requires an admin decision. |
| F4 | Channel ownership verification (critique §4, "sign-in rather than typed handles") | Reading a user's YouTube channels needs a Google OAuth sensitive scope (Google app verification, weeks). Instagram/Facebook needs Meta App Review. Neither is available on day one. | MVP verifies channels by **bio-code**: buyer places a one-time code in the channel description or bio. YouTube is checked automatically with the YouTube Data API (API key, public data, no OAuth); Instagram/Facebook are checked by an admin. `ChannelVerifier` interface leaves room for OAuth verifiers. Clearance requests are not blocked on verification; unverified channels are shown as such to the seller and on the verify page. |
| F5 | Platform as principal; seller royalties paid from own funds | Royalties to individual composers/artists for permitting use of copyright likely attract **GST reverse charge** payable by the platform; GST-registered labels charge forward GST on their royalty invoice. TDS on royalties applies. Rates/thresholds unconfirmed. **[CA]** | Payout lines carry `royalty_base`, `tds`, `seller_gst` (forward charge) and `rcm_gst` (platform liability) fields computed from seller tax profile + config. Values are config, not constants. Finance admin reviews every payout batch before release. |
| F6 | GST invoice for every tier | B2B e-invoicing (IRN) becomes mandatory once the platform's aggregate turnover crosses the threshold (currently ₹5 cr). Not needed at launch. | Invoice table has nullable `irn`, `irn_ack_no`, `signed_qr`. `EInvoiceProvider` interface defined, not implemented. Turning it on is a config + one adapter. |
| F7 | Payouts to Indian bank rails | Automated payouts (RazorpayX) need a current account linked to RazorpayX and its own KYC. | `PayoutRail` interface: `RazorpayXRail` and `BankFileRail` (generates a bulk-transfer CSV that finance uploads to the bank, then records UTRs). MVP can ship on `BankFileRail` alone. |
| F8 | Geography line: "GST/TCS as e-commerce operator/marketplace facilitator" (working assumption A15) | Contradicts the locked principal model. TCS under GST §52 applies to an operator collecting money for *other* suppliers; under the principal model the platform is the supplier, so there is no TCS. | Plan follows the principal model (later, more specific decision): platform GST on the full sale value, no TCS, no e-commerce-operator TCS returns. If counsel recharacterises the arrangement as a marketplace, invoicing and payouts change (critique §5.5) — **[CA]** sign-off before launch. |
| F9 | Do-not-cut floor + critique §4 (malware scan on uploaded documents) | Adopting the BigSocials stack (Vercel serverless) removes the place ClamAV ran: it needs a resident daemon and ~300 MB of signatures, which a Vercel function cannot host. | Rights/KYC documents limited to PDF/JPG/PNG ≤ 10 MB, magic bytes must match the declared type, stored in a private bucket, opened only by admins as downloads (never rendered inline on the app origin). Residual risk: a malicious PDF reaching an admin's machine. A hosted scanning API can slot in later at the validation step. **Accepted by owner 2026-11-12.** |
| F10 | Clearance/dispute timers (1 business day, 48h) and fulfilment retries | BigSocials' crons are all daily. Sub-daily Vercel Cron schedules need the Vercel Pro plan. | **Owner decision 2026-11-12: daily crons only for now; revisit later in the build.** Primary triggers are `after()` calls, so fulfilment and email do not wait for cron. Overdue flags in admin queues stay live because they are computed from `due_at`. Accepted lag: a fulfilment or email whose `after()` run failed is retried up to a day later, and overdue notices to buyers/sellers go out once a day. Admins can re-run a stuck order or email from the console. Moving to sub-daily is a `vercel.json` schedule change only (§5.8). |
| F11 | Backups (do-not-cut) | Supabase backups cover the database only, not Storage objects. Masters, rights documents, certificates and invoices would have no backup. PITR is a paid add-on. | Daily `storage-backup` cron copies new and changed objects to an off-site S3-compatible bucket **Cloudflare R2** (owner decision 2026-11-12; S3-compatible, no egress fees on restore). That is one service BigSocials does not use. PITR add-on enabled on the production project. |

Nothing else in the locked list is technically blocked.

---

## 2. Architecture

### 2.1 Shape

A **modular monolith** on the same stack as the team's BigSocials app: one Next.js App Router project does frontend and backend, deployed on Vercel, with Postgres, Auth and Storage on Supabase (Mumbai). There is no separate backend service and no long-running worker process.

```
 Browser ──HTTPS──▶ Vercel: Next.js 16 (App Router)
                     ├─ server components / server actions (mutations)
                     ├─ route handlers app/api/*: Razorpay webhook, seller clearance links,
                     │    background handlers (ingest, fulfil, outbox), cron endpoints
                     └─ after(): kicks background handlers once the response is sent
                          │                         │
                Supabase Postgres (Drizzle)    Supabase Storage (private buckets)
                all state, outbox, RLS on      masters / previews / docs / pdfs
                every table                    signed URLs only
                          ▲
                Vercel Cron (vercel.json): backstop sweeps, reconciliation, payouts, backups
 External: Razorpay (checkout, refunds, webhooks) · RazorpayX or bank file (payouts)
           ACRCloud (screening) · Resend (email) · MSG91 (phone OTP) · YouTube Data API (bio-code check)
           Off-site bucket for storage backups (F11)
```

**Background work without a worker: state is the queue.** Each kind of background work is identified by a row in a known state: a `paid` order needs fulfilling, a `pending` track version needs ingesting, an `outbox` row in `pending` needs sending. The request that creates that state calls `after()` to run the handler for that one row immediately. A Vercel Cron sweep runs the same handler over any rows still waiting (crash, timeout, deploy). Handlers claim rows with `SELECT … FOR UPDATE SKIP LOCKED` or a compare-and-set, and are idempotent, so the `after()` run and the sweep can overlap safely. No generic job queue, no Redis.

Why this shape: the hard parts are state machines, money and legal records, which want one transactional database. Matching the BigSocials stack means one set of tools, deploy pipeline and conventions across the team's projects.

### 2.2 Tech stack

Mirrors BigSocials (`BigSocials-Tech-Stack.docx`, main at 486cc1fa). The few departures are listed after the table.

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, server components by default), React 19.2 | Same as BigSocials. SSR public catalog/track pages (SEO), server actions for mutations, route handlers for webhooks and cron. Session refresh in `proxy.ts`. |
| Language | TypeScript 5, strict | Types carry the state-machine and money rules. |
| Styling / UI | Tailwind v4 (CSS config in `app/globals.css`), shadcn/ui on Radix, Lucide icons, next-themes | Same as BigSocials; accessible primitives for the WCAG 2.1 AA target. |
| Data / forms | TanStack Query 5, React Hook Form + Zod 4, Sonner; filters and sort in URL search params | Same as BigSocials. zod also validates route handlers, webhooks and env. |
| Charts | Chart.js + react-chartjs-2 | Seller sales/payout views and admin metrics, when needed. |
| Database | Supabase Postgres, Mumbai; transaction-mode pooler URL for the app, `DIRECT_URL` for drizzle-kit | Transactions, row locks, CHECK constraints, triggers for immutability, full-text search, `pg_trgm`. |
| ORM / SQL | Drizzle ORM (postgres-js driver); schema in `db/schema.ts`, SQL migrations in `db/migrations` | Compare-and-set `UPDATE … WHERE status = …` and hand-written triggers/RLS in migrations. Never `db:push` against production (it can wipe RLS policies). |
| RLS | Enabled on every table, no policies for `anon`/`authenticated` unless a page needs one | BigSocials project rule. Supabase exposes tables through its public REST API; RLS-with-no-policy closes that path. All app data access is server-side Drizzle. |
| Auth | Supabase Auth: email OTP, phone OTP (MSG91), Google OAuth; TOTP MFA (AAL2) | Same as BigSocials. AAL2 required for admins and for sellers changing payout details. Platform roles and org membership live in our own tables (Supabase has no organisations). |
| Background work | `after()` + Vercel Cron sweeps over state (§2.1) | Fits Vercel; no worker to run. |
| Payments | Razorpay Orders + Standard Checkout, refunds, webhooks with HMAC check | Same gateway as BigSocials. **No escrow / Route split settlement**: the principal model means the buyer pays the platform for its own supply. |
| Payouts | `PayoutRail` adapter: bank bulk file first, RazorpayX Payouts later | See F7. |
| Storage | Supabase Storage, private buckets, signed upload and download URLs | Same as BigSocials. Masters never public. |
| Audio | ffmpeg / ffprobe via `ffmpeg-static` in a Node route handler (`maxDuration` 300 s, files staged in `/tmp`) | Validation, preview with audible tag, preview download, MP3 derivative, waveform peaks. Caps the master upload at 200 MB (Vercel `/tmp` is 512 MB). |
| Fingerprinting | ACRCloud (public catalog + a private bucket of our own approved tracks) behind `FingerprintScreener` | One vendor covers known-release detection and cross-seller duplicates. HTTP call from server code. |
| PDF | `@react-pdf/renderer` | Already in BigSocials. Certificates, invoices, credit notes, dispute kits, payout statements. |
| QR | `qrcode` | Encodes the verify URL. |
| Email | Resend via the transactional outbox | Same as BigSocials. Email is the only notification channel (critique cut 17); MSG91 is for login OTP only. |
| Hosting / deploy | Vercel; GitHub Action `vercel-deploy.yml` (production on push to `main`, previews on PRs); Vercel Cron in `vercel.json` | Same as BigSocials. Pull requests only, never push to `main`. |
| Secrets | Names in `.env.local.example`; values in local env files and Vercel | Same as BigSocials. App-level encryption key for PAN/bank data is an env secret. |
| Testing | Vitest 4 (happy-dom for components; integration tests against a real local Supabase Postgres), Playwright for e2e, Razorpay test mode | Same tools as BigSocials. Unlike BigSocials, the checkout golden path e2e **is** a CI gate here: `.github/workflows/e2e.yml` runs it, with Razorpay, Supabase Auth and Storage replaced by in-process stand-ins (STATE: S4-M11 e2e in CI). |
| Tooling | npm, ESLint 9 (eslint-config-next + import boundary rule), `tsc --noEmit`; CI: `npm ci`, env-file guard, tsc, ESLint, Vitest, `npm audit` (critical), `next build` | Same as BigSocials `ci.yml`. |

Departures from BigSocials, all deliberate:
- **Node 22 LTS** in CI and on Vercel. BigSocials CI runs Node 20, which reached end-of-life in April 2026.
- **No pgvector, no LLM provider, no Web Push, no Instagram Graph integration.** Suggestions are a metadata query (locked decision). Notifications are email only. Channel checks use bio-codes, not Graph API OAuth (F4).
- **No ClamAV** (F9) and **no Redis/queue** (§2.1). Both follow from Vercel's serverless runtime.
- **Off-site storage backup bucket** (F11), a service BigSocials does not use.

Not used, deliberately: Elasticsearch, microservices, an ML pipeline, a forensic-watermark vendor, a Content ID/Rights Manager client.

### 2.3 Modules

Each module is a slice in `lib/<slice>/` (BigSocials convention): `index.ts` is the barrel for code safe anywhere, `server.ts` for server-only code, implementation under `internal/`. ESLint blocks imports of `lib/*/internal/**` from outside the slice. Each slice owns its tables; cross-slice writes go through the owning slice's functions.

| Module | Owns | Responsibilities |
|---|---|---|
| `identity` | users, orgs, members, sessions | Auth, roles, org membership, 2FA enforcement, admin permission sets, impersonation (read-only, audited). |
| `legal` | legal_documents, acceptances | Versioned ToS / seller agreement / privacy notice / per-tier license texts; acceptance gate; re-acceptance on new version. |
| `sellers` | seller_profiles, payout_accounts, tax profiles | Seller onboarding (self-serve artist vs concierge label), KYC, bank verification, ops contact for clearance. |
| `catalog` | tracks, track_versions, rights_documents, rights_declarations, genres, moods | Track lifecycle, upload pipeline, metadata, publishing, search, suggestions. |
| `screening` | screenings, claim_probes | Fingerprint screening adapter, claim-probe records, clearance-class assignment. |
| `pricing` | price_books, price_book_entries | Platform-owned price grid by price level × tier, versioned. |
| `licensing` | license_terms_versions, licenses, licensed_channels, licensed_videos | Tier rules, availability checks, license issuance, record hash, cap enforcement, expiry, revocation. |
| `orders` | orders, order_events | Checkout, order state machine, fulfilment orchestration. |
| `payments` | payment_events, refunds, chargebacks | Razorpay adapter, webhook ingest, reconciliation. |
| `invoicing` | invoice_series, invoices, credit_notes | GST computation, number allocation, invoice/credit-note PDFs, `EInvoiceProvider` slot. |
| `certificates` | certificates | Certificate PDF, QR, verify page, dispute-kit PDF. |
| `clearance` | channel_verifications, clearance_requests | `ClearanceProvider` + `ChannelVerifier` adapters, manual seller clearance workflow, seller response links. |
| `disputes` | disputes, dispute_events, copyright_complaints | Buyer disputes, timers, refund eligibility, third-party complaint intake. |
| `ledger` | ledger_entries | Append-only seller royalty ledger, hold, clawbacks. |
| `payouts` | payout_batches, payouts | Monthly run, TDS/GST lines, `PayoutRail` adapter, statements. |
| `enquiries` | enquiries | Commercial/Broadcast enquiry form and admin handling. |
| `notifications` | outbox | Transactional outbox, email templates, Resend sender. |
| `audit` | audit_log | Append-only admin/system action log. |
| `platform` | rate_limits, storage_backups | Shared infrastructure, no business logic: db client, Supabase clients, storage, background-handler runner, crypto, env, rate limiting. |

### 2.4 Source layout

Same top-level layout as BigSocials (no `src/`):

```
app/
  (public)/             catalog, track/[slug], verify/[publicId], legal/*, enquiry
  (buyer)/              account, licenses, licenses/[id], orders, disputes
  seller/               onboarding, tracks, tracks/[id], sales, payouts, clearance
  admin/                queues and tools (see §9)
  auth/                 sign-in, OTP, MFA enrolment
  api/webhooks/razorpay/route.ts
  api/clearance/respond/[token]/route.ts
  api/tasks/<handler>/route.ts     background handlers (ingest, fulfil, outbox, …), secret-protected
  api/cron/<sweep>/route.ts        Vercel Cron entry points, CRON_SECRET-protected
lib/<slice>/            index.ts, server.ts, internal/**, *.test.ts
lib/platform/           db.ts, supabase.ts, storage.ts, tasks.ts, crypto.ts, env.ts, ratelimit.ts
db/schema.ts            Drizzle schema (may re-export per-slice files under db/schema/)
db/migrations/          drizzle-kit output + hand-written SQL (RLS, triggers, constraints)
proxy.ts                Supabase session refresh
scripts/                tsx scripts: seed, concierge bulk import, restore drill
tests/e2e/              Playwright
vercel.json             cron schedule
```

---

## 3. Data model

Conventions: internal IDs are UUIDv7. Money is `bigint` paise, never floating point. Timestamps are `timestamptz` in UTC, displayed in IST. Every state-bearing table has a `status` column with a Postgres `CHECK` listing its states, and transitions happen only through the owning module (§4).

### 3.1 Identity, organisations, legal

- **users**: id (= Supabase `auth.users.id`), email (unique, verified_at), phone, name, platform_role (`none` | `admin`), admin_permissions (set of `verification`, `clearance`, `disputes`, `finance`, `superadmin`), totp_enabled, created_at.
- **organizations**: id, kind (`seller` | `buyer`), legal_name, display_name, buyer_type (`individual` | `business` | `agency`, buyer orgs only), gstin (nullable, validated format + checksum), state_code, billing_address. Every buyer and seller acts through an org; an individual creator is a one-member org of type `individual`.
- **memberships**: user_id, org_id, role (`owner` | `member`).
- **legal_documents**: id, kind (`tos`, `privacy`, `seller_agreement`, `release_commitment`, `license_creator`, `license_brand_organic`, `license_paid_ad`), version, body_markdown, sha256, effective_at. Immutable after insert.
- **acceptances**: id, user_id, org_id, legal_document_id, accepted_at, ip, user_agent. Append-only.

### 3.2 Sellers

- **seller_profiles**: org_id, entity_type (`individual` | `company` | `partnership` | `llp`), pan_encrypted, gstin, gst_registered, onboarding_mode (`self_serve` | `concierge`), royalty_rate_bps (per contract; default from config), ops_contact_email, ops_contact_phone, kyc_status (`pending` | `verified` | `rejected`), status (`active` | `suspended` | `closed`), worldwide_rights_warranted (bool).
- **payout_accounts**: seller_org_id, account_number_encrypted, ifsc, account_holder_name, name_match_status, verified_at, rail_ref (fund account id). Changing it requires recent TOTP and resets `verified_at`; payouts pause until re-verified.

### 3.3 Catalog

- **tracks**: id, seller_org_id, slug, title, primary_artist, featured_artists, composers, lyricists, genre_id, mood_ids, language (`hindi` | `punjabi` | `tamil` | `english` | `instrumental`), bpm, explicit, ai_generated_declared, usage_flags {organic_social, paid_ads, edits_allowed}, price_level, clearance_class (`unclassified` | `A` | `B` | `C`), status (§4.1), current_version_id, published_at, search_vector.
- **track_versions**: id, track_id, version_no, master_key, master_sha256, master_format, duration_ms, preview_key, preview_download_key, mp3_derivative_key, waveform_key, ingest_status (`pending` | `processing` | `ready` | `failed`), created_at. Replacing audio creates a new version; licenses point at the version they bought.
- **rights_declarations**: track_id, master_controlled (bool), composition_controlled (bool), co_owner_consent_warranted (bool), sample_free_warranted, not_a_cover_warranted, registrations (list of {system: `youtube_cid` | `meta_rm` | `other`, administered_by, seller_controls_release}), accepted_document_id (seller agreement version).
- **rights_documents**: id, track_id or seller_org_id, doc_type (`pro_registration`, `distribution_agreement`, `publishing_agreement`, `self_declaration`, `other`), file_key, validation_status (`pending` | `valid` | `rejected`), uploaded_at.
- **genres**, **moods**: admin-managed fixed lists (≈15–20 genres).

### 3.4 Screening and classification

- **screenings**: id, track_version_id, provider, status (`queued` | `clean` | `match` | `error` | `unavailable`), matches (jsonb: title, artist, label, score), created_at.
- **claim_probes**: id, track_version_id, platform (`youtube` | `meta`), probed_by (admin), probed_at, claims_observed (jsonb: claimant, policy), notes.
- Class assignment is an admin action that writes `tracks.clearance_class` and an audit entry, citing the screening and probe IDs. Class B additionally requires an accepted `release_commitment` document and a seller ops contact.

### 3.5 Pricing and licensing

- **price_books**: id, version, effective_at, status (`draft` | `active` | `retired`). One active at a time.
- **price_book_entries**: price_book_id, price_level (`L1`..`L5`), tier, amount_paise (taxable value, GST-exclusive). The platform owns pricing (a principal-model requirement). Sellers propose a level at upload; the admin sets it at review.
- **license_terms_versions**: id, tier, version, term_kind (`perpetual` | `fixed_months`), term_months (12 for paid ad), video_cap (1, 3, or null), max_channels, allowed_platforms, organic_only, license_text_document_id, effective_at. Immutable.
- **licenses**: id, public_id (unique, §7), order_id (unique), track_id, track_version_id, master_sha256, tier, terms_version_id, license_text_document_id, licensee_name, client_name (nullable), purchaser_org_id, territory (`worldwide`), edits_allowed, starts_at, ends_at (null when perpetual), record_hash, status (§4.4), revoked_reason, renews_license_id (nullable).
- **licensed_channels**: id, license_id, platform (`youtube` | `instagram` | `facebook`), handle_or_url, external_id, verification_status (`unverified` | `pending` | `verified`), added_at, removed_at. Count ≤ `max_channels`.
- **licensed_videos**: id, license_id, label (buyer's name for the creative), urls (text[]), registered_at. One row = one "video" (§5.3). Count ≤ `video_cap` when set.

### 3.6 Orders, payments, invoicing

- **orders**: id, buyer_org_id, buyer_user_id, idempotency_key (unique with buyer_user_id), track_id, track_version_id, tier, terms_version_id, price_book_id, snapshot {taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, gst_rate_bps, place_of_supply_state, recipient_gstin, licensee_name, client_name, channels[]}, gateway_order_id (unique), gateway_payment_id (unique, nullable), status (§4.3), expires_at, paid_at, fulfilled_at.
- **order_events**: order_id, from_status, to_status, actor, reason, at. Append-only.
- **payment_events**: id, gateway_event_id (unique), event_type, payload (jsonb), received_at, processed_at. Webhook dedupe table.
- **refunds**: id, order_id (unique — full refunds only), reason (`claim_not_released` | `platform_error` | `invalid_rights` | `unsellable_at_fulfilment` | `admin_goodwill`), amount_paise, gateway_refund_id, status (`requested` | `processing` | `processed` | `failed`), requested_by, created_at.
- **chargebacks**: id, order_id, gateway_dispute_id (unique), status (`open` | `won` | `lost`), amount_paise.
- **invoice_series**: fy (e.g. `2026-27`), kind (`invoice` | `credit_note`), next_number. Row-locked on allocation.
- **invoices**: id, order_id (unique), number (unique), fy, issued_at, supplier_gstin, supplier_state_code, recipient_name, recipient_gstin (nullable), recipient_state_code, place_of_supply_state, sac_code, taxable_paise, cgst/sgst/igst_paise, total_paise, line_description (track, tier, client name), pdf_key, irn/irn_ack_no/signed_qr (nullable). Immutable after insert.
- **credit_notes**: id, invoice_id, number, fy, reason, amounts mirroring the invoice, pdf_key. Immutable.

### 3.7 Certificates, clearance, disputes

- **certificates**: id, license_id, revision, pdf_key, pdf_sha256, generated_at. New revision when channels change; `record_hash` never changes.
- **channel_verifications**: id, licensed_channel_id, method (`bio_code` | `oauth_google` | `oauth_meta`), code, status, checked_by, checked_at.
- **clearance_requests**: id, license_id, licensed_channel_id or licensed_video_id, seller_org_id, provider (`manual_seller` | future), scope (`channel` | `video`), status (§4.5), respond_token_hash, due_at, sent_at, responded_at, seller_note, evidence_key.
- **disputes**: id, license_id, opened_by, video_url, platform, dispute_type (`content_id_claim` | `copyright_strike` | `mute` | `ad_rejection` | `other`), claimant_name, clearance_class_at_open, status (§4.6), first_action_due_at, resolution_due_at (null outside Class A/B), refund_eligible_at, resolution, closed_at.
- **dispute_events**: dispute_id, kind, note, actor, at. Append-only.
- **copyright_complaints**: id, complainant_name, complainant_email, track_id (nullable), work_claimed, evidence_key, status (`received` | `investigating` | `upheld` | `rejected`), grievance_officer_id, received_at, acknowledged_at, closed_at.
- **enquiries**: id, org_id (nullable), contact, track_id, intended_use, media (TV/OTT/cinema/other), budget_range, status (`new` | `contacted` | `closed_won` | `closed_lost`).

### 3.8 Money out

- **ledger_entries**: id, seller_org_id, kind (`sale_royalty` | `refund_reversal` | `chargeback_reversal` | `clawback` | `payout` | `adjustment`), amount_paise (signed), order_id (nullable), payout_id (nullable), available_at, created_at, created_by. Unique on (order_id, kind) where order_id is set. Append-only.
- **payout_batches**: id, period (YYYY-MM), cutoff_at, status (§4.7), approved_by, approved_at.
- **payouts**: id, batch_id, seller_org_id, royalty_base_paise, tds_paise, seller_gst_paise, rcm_gst_paise, net_paise, rail, rail_ref, utr, status, statement_pdf_key.

### 3.9 Cross-cutting

- **audit_log**: id, actor_user_id (nullable for system), impersonated_by (nullable), action, entity_type, entity_id, before (jsonb), after (jsonb), ip, at. Append-only.
- **outbox**: id, kind, to, template, payload, status, attempts, sent_at. Written in the same transaction as the state change it reports.

### 3.10 Key relationships

Seller org 1—N Track 1—N TrackVersion. Track 1—1 RightsDeclaration, 1—N RightsDocument. TrackVersion 1—N Screening, 1—N ClaimProbe. Order 1—1 License 1—1 Invoice (0..1 CreditNote). License 1—N LicensedChannel, 1—N LicensedVideo, 1—N Certificate revision, 1—N ClearanceRequest, 1—N Dispute. Seller org 1—N LedgerEntry, 1—N Payout. Order 1—N LedgerEntry.

---

## 4. State machines

Each machine is a transition table in its module (`transitions.ts`): `{ from, event, to, guard?, effects }`. Every transition is a compare-and-set `UPDATE … SET status = $to WHERE id = $id AND status = $from`, inside a transaction that also writes the event row, audit entry (admin/system actions) and outbox rows; after commit, `after()` kicks any background handler the new state needs. Zero rows updated means another actor already moved it: return the current state and do nothing.

### 4.1 Track

```
draft ──submit──▶ submitted ──ingest+screening done──▶ in_review
in_review ──approve(class A|B, price_level)──▶ published
in_review ──reject(reason)──▶ rejected ──edit──▶ draft        (unlimited resubmits)
in_review ──classify C──▶ rejected (reason: "Class C — no release path")
published ──suspend(reason)──▶ suspended ──reinstate──▶ published
published|suspended ──delist (seller or admin)──▶ delisted
published ──new version uploaded──▶ (track stays published on old version; new version goes through ingest → review; approval swaps current_version_id)
```

Guards: `submit` requires rights declaration complete, ≥1 rights document, seller agreement accepted, seller kyc not `rejected`. `approve` requires ingest `ready`, a screening result (`clean`, or `match`/`unavailable` with an admin override note), a claim probe on record, clearance_class ∈ {A, B}, and for B an accepted release commitment + ops contact. Only `published` tracks are sellable. `suspended` and `delisted` stop new sales; existing licenses stay valid and the seller remains bound to clear them.

### 4.2 Clearance class

```
unclassified ──probe+review──▶ A | B | C
A ──seller reports new registration / probe finds claim──▶ B (if seller controls release) | C
B ──seller loses control of registration──▶ C
```

Moving to C suspends the track (4.1) and opens a clearance-risk review of its active licenses in the admin queue.

### 4.3 Order

```
created ──gateway order created──▶ awaiting_payment
awaiting_payment ──payment captured (webhook or verified callback)──▶ paid
awaiting_payment ──payment failed──▶ failed
awaiting_payment ──expires_at passed──▶ expired
expired ──late capture──▶ paid                      (money was taken: treat as paid)
paid ──fulfilment complete──▶ fulfilled
paid ──track no longer sellable at fulfilment──▶ refund_pending
fulfilled ──refund approved──▶ refund_pending ──gateway refund processed──▶ refunded
fulfilled ──chargeback opened──▶ charged_back_pending ──won──▶ fulfilled
                                                     ──lost──▶ charged_back
```

Rules: `paid` is reached only after the captured amount and currency match `snapshot.total_paise` and INR; a mismatch writes an alert and leaves the order in `awaiting_payment` for admin. Fulfilment is the `fulfil` background handler for one `paid` order (claimed with `FOR UPDATE SKIP LOCKED`), run by `after()` and by the sweep; it runs the steps in §5.2, each idempotent, so a retry after a crash or timeout finishes the work. `refunded` and `charged_back` revoke the license. Full refunds only.

### 4.4 License

```
active ──ends_at passed (paid ad)──▶ expired
active ──refund | chargeback lost | fraud | breach (admin, reason)──▶ revoked
```

Renewal of a paid-ad license is a new order that produces a new license with `renews_license_id` set; there is no auto-renewal. Expired and revoked licenses still resolve on the verify page with their status.

### 4.5 Clearance request

```
not_required                                   (Class A at issuance: nothing to release)
pending ──email sent to seller ops contact──▶ sent
sent ──seller confirms released/allowlisted (+evidence)──▶ completed
sent ──seller declines / cannot release──▶ failed        (opens refund path)
sent ──due_at passed──▶ overdue ──seller completes──▶ completed
overdue ──admin escalates──▶ escalated ──completed | failed
```

Created for Class B licenses at issuance (scope `channel`, one per licensed channel) and on each video registration (scope `video`). `due_at` = sent_at + seller-contract turnaround (config, default 1 business day). Seller turnaround is tracked per seller for delisting decisions.

### 4.6 Dispute

```
open ──first action recorded (seller contacted / buyer told)──▶ in_progress
in_progress ──claim released──▶ resolved_released
in_progress ──claim valid: buyer out of scope──▶ resolved_denied (reason; may lead to license revocation)
in_progress ──refund window passed without release, claimant is cataloged rightsholder or Class A claim──▶ refund_eligible ──refund processed──▶ resolved_refunded
in_progress ──third-party claim outside platform's control──▶ resolved_kit_issued (buyer pursues via dispute kit; refund_eligible still applies on its window)
open | in_progress ──48h resolution deadline missed by ops (Class A/B only)──▶ refund_eligible   [added after the S3-M6 review: protects the buyer from an ops failure; accepted risk of gaming]
open ──refund window passed, claimant is cataloged rightsholder or Class A claim──▶ refund_eligible   [same decision: an untouched dispute is covered too]
```

An `open` dispute reaches `refund_eligible` on the 48h deadline only once its `first_action_due_at` has also passed (a Friday report is due Monday but its 48 hours end on Sunday). Once `refund_eligible`, ops can no longer record a first action or resolve the dispute; finance decides the refund.

Timers set at `open`: `first_action_due_at` = +1 business day (all disputes); `resolution_due_at` = +48h only when the track is Class A or B (F1 for Class A meaning); `refund_eligible_at` = +`CLAIM_RELEASE_REFUND_WINDOW_DAYS` (config, 7 days, **[Lawyer]**). Overdue is a derived flag (`now() > due_at` and not closed) that drives the admin overdue filter and a buyer notification; there is no SLA engine. Dispute types are reported separately (claim, strike, mute, ad rejection).

### 4.7 Payout batch and payout

```
batch: draft ──compute──▶ computed ──finance approves (TOTP)──▶ approved ──submitted to rail──▶ processing ──all payouts settled──▶ completed
payout: pending ──rail submit──▶ processing ──paid (utr)──▶ paid
                                            ──failed──▶ failed (ledger reversal entry; carried to next run)
```

---

## 5. Core flows

### 5.1 Ingest (seller upload or concierge import)

1. Client requests a Supabase Storage signed upload URL from a server action (WAV/MP3 only, ≤ 200 MB, enforced by bucket limits and re-checked server-side). Rights documents: PDF/JPG/PNG, ≤ 10 MB.
2. On submit, the version is `pending` and `after()` runs the `ingest` handler (also swept by cron): ffprobe (format, duration 15 s–15 min, sample rate) → sha256 of master → render preview → render downloadable watermarked preview → MP3 320 derivative → waveform peaks JSON. Rights documents get the F9 validation (magic bytes match declared type, size, page count/dimensions sane). Any failure sets `ingest_status = failed` with a seller-visible reason.
3. The `screen` handler runs for versions with ingest `ready` and no screening, against the vendor's commercial catalog and the platform's own bucket (duplicates across sellers). Matches go to the review queue with scores.
4. Admin performs the claim probe (private upload on the platform's test channel/page), records claims observed, assigns class and price level, approves or rejects with a reason.
5. On approve: track published; the version's fingerprint is added to the platform's own screening bucket.

Concierge label onboarding uses `scripts/import-catalog.ts`: a CSV of metadata + a local folder of masters (uploaded to Storage by the script), run by an admin, creating tracks as `submitted` under the label's seller org. Every imported track still passes ingest, screening, probe and review.

### 5.2 Checkout and fulfilment

1. Buyer on a published track picks a tier available for it (§6.1), enters licensee name (defaults to org legal name), optional client name, channel(s), billing state (mandatory) and GSTIN (optional; validated). Must have accepted the current ToS and sees the tier's license text.
2. `createOrder` (server action, idempotency key from the client): validates availability and inputs, snapshots price book entry, terms version, license text version, GST computation (§8.2); creates the Razorpay order (receipt = order id); returns checkout params. Order `awaiting_payment`, expires in 30 min.
3. Razorpay Checkout completes. The client callback posts `razorpay_payment_id/order_id/signature`; server verifies the signature and fetches the payment from Razorpay. Independently, the `payment.captured` webhook arrives. Both paths call the same `markPaid(orderId, paymentId, amount)` compare-and-set; whichever lands first wins, the other is a no-op.
4. `markPaid` transaction: order → `paid`. After commit, `after()` runs the `fulfil` handler for that order; the fulfilment sweep catches any order left in `paid`.
5. `fulfil` steps, each idempotent:
   a. Re-check sellability (track `published`, seller `active`). If not: order → `refund_pending`, refund reason `unsellable_at_fulfilment`, stop.
   b. **Legal-facts transaction**: insert license (unique order_id) with `public_id` and `record_hash`; allocate invoice number and insert invoice; insert `sale_royalty` ledger entry with `available_at = paid_at + 30 days`; insert licensed channels; insert clearance requests (or `not_required` for Class A); write outbox emails. All or nothing.
   c. Render invoice PDF and certificate PDF (revision 1) to Storage; store keys and certificate sha256. Re-renderable from rows at any time.
   d. Order → `fulfilled`.
6. Buyer license page shows certificate, invoice, license text, dispute kit, clean-file download, channels, video registration, clearance status per channel.

"Instant" means seconds for certificate and invoice. Clearance is visibly asynchronous: the license page shows each channel's clearance status, never a promise of protection (critique C1).

### 5.3 Usage registration and caps

- **A "video"** = one creative. Cross-posting the same creative to YouTube, Instagram and Facebook, and its cut-downs (length or aspect-ratio variants of the same creative), count as one video; the buyer adds each URL to the same `licensed_videos` row. A different creative is a new video. (New working assumption; mirrored in license text.)
- Creator: 1 video; Brand Organic: up to 3; Paid Ad: no creative cap within the 12-month term, but every creative published on YouTube must be registered so it can be cleared.
- Registering a URL for a Class B license creates a `video`-scope clearance request.
- Buyers are told to upload private/unlisted first, register the URL, and publish once clearance is complete (critique §5.1 step 4).
- Channel correction: a buyer may replace a channel while it has no registered videos, up to 2 corrections per license; afterwards via support. Creates a new certificate revision.

### 5.4 Disputes and refunds

1. Buyer reports from the license page: video URL, platform, type, claimant name as shown by the platform. Dispute `open`; timers set (§4.6); email to buyer and the seller's ops contact; admin queue entry.
2. Admin records the first action within one business day.
3. Release confirmed → `resolved_released`. Buyer exceeded scope → `resolved_denied` with reason. Window passes without release from a cataloged rightsholder (or a Class A claim) → `refund_eligible`; finance approves the refund.
4. Refund: Razorpay refund (full), credit note issued, license revoked, download links disabled, ledger `refund_reversal` against the seller (and `clawback` if the original royalty was already paid out, F2). Liability is capped at the fees paid; nothing beyond a full refund is ever computed.

Refunds happen only for the reasons in `refunds.reason`; there is no buyer self-serve refund.

### 5.5 Third-party copyright complaints

Public form (`/legal/copyright-complaint`) → `copyright_complaints` row, acknowledgement email, grievance officer queue. Upholding a complaint suspends the track (4.1) and opens a revocation/refund review of its licenses. Timelines follow the grievance policy **[Lawyer]**.

### 5.6 Payout run

Monthly, on the configured day: `payouts.compute(period)` sums each seller's ledger entries with `available_at ≤ cutoff` not yet attached to a payout; skips sellers below the minimum payout, without verified KYC/bank, or with a net negative balance (carried forward). Computes TDS, seller GST and RCM GST from the seller's tax profile and config. Finance reviews and approves with TOTP; submission goes through the `PayoutRail` with the payout id as the idempotency key. Paid payouts write a `payout` ledger debit; failures write nothing and carry forward. Seller gets a statement PDF. Seller balances are never spendable on purchases and never withdrawable on demand.

### 5.7 Reconciliation

Daily cron: fetch Razorpay payments and settlements for the previous day; compare against orders (captured but not `paid`, `paid` without capture, amount mismatches, refunds without credit notes). Mismatches create admin reconciliation items. Expiry is lazy: an `awaiting_payment` order past `expires_at` is checked against Razorpay when next read and by the sweep before being marked `expired`.

### 5.8 Cron schedule (`vercel.json`)

| Sweep | Schedule | Work |
|---|---|---|
| `tasks-sweep` | daily (F10; target every 10 min later) | Run `fulfil`, `ingest`, `screen`, `outbox` handlers over rows still waiting; expire stale `awaiting_payment` orders. |
| `timers` | daily (F10; target hourly later) | Clearance and dispute overdue notices to buyers/sellers/admins; renewal reminders. |
| `reconcile` | daily | §5.7. |
| `licenses-expire` | daily | Paid-ad licenses past `ends_at` → `expired`. |
| `payouts` | daily (acts on the configured day of month) | Compute the monthly batch (§5.6). |
| `storage-backup` | daily | Copy new and changed Storage objects to the off-site bucket (F11). |
| `rate-limit-cleanup` | daily | Delete expired rate-limit buckets. |

Each cron route checks `CRON_SECRET` and is idempotent. All schedules are daily for now (F10); because `after()` is the primary trigger, admin queues also get a "re-run" action for a stuck order or email. **Revisit before launch**: sub-daily `tasks-sweep` and `timers` need Vercel Pro and are a `vercel.json` change only.

---

## 6. Licensing engine

### 6.1 Tiers and availability

| Tier | Self-serve | Term | Video cap | Channels | Requires seller flag | Notes |
|---|---|---|---|---|---|---|
| `creator` | yes | perpetual | 1 | up to 3 handles owned by the licensee | `organic_social` | Organic, non-sponsored content. Monetised channels allowed; sponsored/paid-partnership content needs `brand_organic`. |
| `brand_organic` | yes | perpetual | 3 | up to 3 official brand handles | `organic_social` | No paid spend or boosting. |
| `paid_ad` | yes | 12 months, renewable by new purchase | none (registration required) | up to 3 pages/channels publishing the ads | `paid_ads` | Meta Ads, Google Ads, OTT digital pre-roll. License text states ad-review outcomes are outside platform control. |
| `commercial_broadcast` | **no** — enquiry form | negotiated | — | — | — | Handled offline; no license record in MVP. |

`edits_allowed` is a modification right printed on the license, not a tier gate. Territory is worldwide for online distribution; sellers warrant worldwide rights at onboarding and tracks without them are not accepted. Tier rules live in `license_terms_versions` rows and are pinned on each license; code reads the pinned version, never "current" rules, for an existing license.

### 6.2 License text and acceptance

Each tier's license text is a `legal_documents` version. The license text covers: grant, term, territory, media, modification, attribution, non-transferability, purchase on behalf of a named client (agencies), registration and clearance process, refund and liability cap, Content ID claims vs strikes. The order snapshots the version; the license pins it; the certificate prints its version number and the verify page links to it.

### 6.3 Agency purchases

No workspace in MVP. An agency org buys with an optional `client_name`. `licensee_name` = client name when present, otherwise the purchaser org's legal name. The invoice is addressed to the purchasing agency with the client name on the line; the certificate shows "Licensee: client · Purchased by: agency". Agencies can filter their license list by client name.

---

## 7. Certificates, verification and the record hash

- **public_id**: 128 random bits from a CSPRNG, Crockford base32, grouped for reading: `LIC-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX` (26 data chars). Not derived from any sequence, so it cannot be enumerated.
- **Verify page** `/verify/{public_id}`: server-rendered from the database (the record is the source of truth, critique cut 13). Shows status (active/expired/revoked), track title and artist, tier, term, territory, licensed channels with verification status, issue date, license text version, record hash. Licensee: organisations shown in full; individuals shown masked (first letter + asterisks per name part) unless they opt in to full display (critique G18). `noindex`, rate-limited per IP, uniform 404 for unknown IDs.
- **record_hash**: SHA-256 over the RFC 8785 canonical JSON of the immutable grant: `{public_id, track_version_id, master_sha256, track_title, primary_artist, tier, terms_version_id, license_text_sha256, licensee_name, client_name, purchaser_org_id, territory, edits_allowed, starts_at, ends_at, invoice_number}`, prefixed with a schema tag (`mrm-license-v1`). Computed once at issuance. The certificate prints the first 16 hex chars; the verify page shows the full hash and recomputes it from the stored fields, displaying "record intact" or raising an admin alert on mismatch. Mutable facts (status, channels, videos) are deliberately outside the hash and are shown live. No signing key: there is nothing for a buyer to verify offline that the server lookup does not already prove.
- **Certificate PDF**: license public_id, QR to the verify URL, record hash prefix, licensee/purchaser, track details, tier, permitted use, term, territory, channels at render time, license text version, issue date, "Clearance is a process, not a guarantee" wording approved by counsel **[Lawyer]**. Revisions on channel changes; previous revisions retained.
- **Dispute kit PDF**: certificate summary + full license text + platform-specific suggested dispute wording (YouTube claim, YouTube strike counter-notice guidance, Meta claim, Meta ad rejection appeal) + the verify URL.

---

## 8. Payments, GST, payouts

### 8.1 Razorpay integration

- Orders API with `receipt = order.id`, amount = `snapshot.total_paise`, currency INR, `notes.order_id`. Auto-capture on.
- Webhook endpoint reads the **raw body**, verifies `X-Razorpay-Signature` (HMAC-SHA256 with the webhook secret, constant-time compare), dedupes on `x-razorpay-event-id` via `payment_events` unique insert, then dispatches. Always returns 2xx after a successful dedupe insert; processing errors leave the event with `processed_at` null and are retried by the `tasks-sweep` cron, not by Razorpay redelivery.
- Events handled: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`, `payment.dispute.created/won/lost`.
- Refunds use the refund row id as the receipt so a retry cannot double-refund.
- Keys and secrets in Vercel env (names in `.env.local.example`); test mode in every non-production environment.

### 8.2 GST computation

- Platform is the supplier of every license. `supplier_gstin`, `supplier_state_code`, `sac_code` (working value under heading 9973, licensing services for the right to use intellectual property — exact code **[CA]**), `gst_rate_bps` (1800) are config.
- Place of supply: recipient GSTIN's state code if a GSTIN is given; otherwise the billing state the buyer entered (mandatory field).
- Intra-state (place of supply = supplier state): CGST 9% + SGST 9%. Inter-state: IGST 18%. Computed on `taxable_paise` with round-half-up per component; `total = taxable + taxes`. Pure function with table tests.
- Price book amounts are GST-exclusive; checkout shows taxable value, tax lines and total before payment (new assumption).
- Invoice numbers: per financial year, consecutive, ≤ 16 chars, format `MRM/26-27/000123`; allocated with `SELECT … FOR UPDATE` on `invoice_series` inside the legal-facts transaction, so no gaps on rollback. Credit notes use their own series `MCN/26-27/000001`.
- Invoices without a recipient GSTIN are simply consumer invoices (no "B2C" label); they still carry state and place of supply.
- No TCS (principal model). E-invoicing slot per F6.
- Record retention for invoices, credit notes and ledger ≥ 8 years (config) **[CA]**.

### 8.3 Royalty ledger and payouts

- Royalty per sale = `taxable_paise × royalty_rate_bps / 10000` (seller contract), rounded down; the platform keeps the remainder. GST is never part of the royalty base.
- Ledger is append-only and signed; balance and "available" are derived (`SUM(amount) WHERE available_at ≤ now() AND payout_id IS NULL`).
- Hold: `available_at = paid_at + 30 days` for every sale royalty.
- Refunds/chargebacks: reversal entry for the full royalty, immediately available (so it nets against the next payout); if the royalty was already paid out the same entry produces a negative balance carried forward (clawback, F2).
- TDS (royalty, formerly 194J now under the Income-tax Act 2025 §393) rate and threshold, higher rate without PAN, RCM on composer royalties, forward GST for registered sellers: all config-driven per F5 **[CA]**.

---

## 9. Admin console

All under `/admin`, gated by `platform_role = admin` + TOTP + per-permission checks. Every mutating action writes `audit_log`.

| Area | Permission | Contents |
|---|---|---|
| Verification queue | `verification` | Submitted tracks with ingest status, screening matches, rights declaration, documents (via signed URLs), claim-probe entry, class and price-level assignment, approve/reject with reason, ageing. |
| Concierge import | `verification` | Upload CSV + masters prefix, dry run, import report. |
| Clearance queue | `clearance` | Requests by status and age, per-seller turnaround, resend, escalate, mark complete/failed with evidence. |
| Disputes | `disputes` | Queue with first-action and resolution due dates, overdue filter, event log, actions (record action, resolve, deny, mark refund-eligible). |
| Copyright complaints | `disputes` | Intake queue, track suspension, outcome. |
| Refunds | `finance` | Refund-eligible items, approve/execute, credit notes. |
| Payouts | `finance` | Compute, review lines, approve (TOTP), submit, record UTRs/failures, statements. |
| Reconciliation | `finance` | Daily mismatches, resolve with note. |
| Catalog admin | `verification` | Suspend/reinstate/delist tracks, reclassify, genres/moods, price book versions. |
| Legal documents | `superadmin` | Publish new versions (immutable), see acceptance counts. |
| Users & orgs | `superadmin` | Search, KYC status, suspend, read-only impersonation (audited, banner shown). |
| Enquiries | any admin | Commercial/Broadcast enquiries pipeline. |
| Audit log | `superadmin` | Filterable, read-only. |

---

## 10. Security, privacy, operations

- **Auth**: Supabase Auth with email OTP, phone OTP (MSG91) or Google OAuth; session refresh in `proxy.ts`; TOTP MFA (AAL2) mandatory for admins, and for sellers before adding or changing payout details (checked server-side on the session's AAL, not in the UI); CSRF protection on mutations (server actions origin check + explicit check on route handlers).
- **Supabase keys**: the service-role key and DB URL are server-only env vars. The browser gets only the anon key, used for auth. RLS is enabled on every table with no `anon`/`authenticated` policies, so the public REST API exposes nothing; Storage buckets are private with no public policies.
- **Authorisation**: every query on tenant data is scoped by the caller's org in the slice function, never by a client-supplied org id. Admin permission checks in a single `requireAdmin(permission)` helper.
- **Files**: masters, documents, PDFs in private Storage buckets; served only through signed URLs (previews: 10 min; downloads: 15 min, issued per click and counted, cap 20 per license then support). Rights documents are served to admins as attachments (`Content-Disposition: attachment`), never inline from the app origin (F9).
- **Background endpoints**: `app/api/tasks/*` and `app/api/cron/*` require a shared secret header; they take only an id and re-read state from the DB.
- **Encryption**: PAN and bank account numbers encrypted at the application layer (AES-256-GCM, key from an env secret, key id stored with the ciphertext for rotation); decrypted only in payout and admin-finance code paths, displayed masked.
- **Rate limits**: sign-up, OTP requests, upload, preview URL issuance, verify page, checkout creation, complaint form (Postgres-backed token bucket in `lib/platform/ratelimit`).
- **Data protection (DPDP Act 2023)**: privacy notice versioned and accepted; deletion requests honoured except records retained for tax/legal (invoices, licenses, ledger) **[Lawyer]**.
- **Backups**: Supabase daily backups plus the PITR add-on (RPO ≤ 2 min, needs a paid plan); Storage objects are not in Supabase backups, so the `storage-backup` cron copies them daily to an off-site bucket (F11); quarterly restore drill script (`scripts/restore-drill.ts`) with a written result; target RTO 4 h.
- **Monitoring**: structured JSON logs in Vercel; an `alerts` admin view plus email to the ops address for webhook signature failures, handler failures, orders `paid` > 10 min without `fulfilled`, reconciliation mismatches, record-hash mismatch, clearance/dispute overdue counts. A hosted error tracker can be added later; BigSocials does not use one.
- **Durability of licenses**: licenses, certificates and the verify page never depend on the track or seller still being active; deleting tracks, versions or sellers that have licenses is impossible (FK `RESTRICT` + soft states).

---

## 11. Adapter interfaces (extension points)

Interfaces only where a second implementation is realistically coming. Each has exactly the implementations listed; nothing dormant.

```ts
// clearance — the "whitelisting" seam. A future Content ID intermediary or direct
// API provider implements the same interface; the workflow and tables don't change.
interface ClearanceProvider {
  readonly id: 'manual_seller';                                  // later: 'intermediary_cms' | 'youtube_cid' | 'meta_rm'
  supports(req: { platform: Platform; scope: 'channel' | 'video'; clearanceClass: 'A' | 'B' }): boolean;
  submit(req: ClearanceRequestRecord): Promise<{ status: 'sent' | 'not_required'; externalRef?: string }>;
  poll?(req: ClearanceRequestRecord): Promise<ClearanceOutcome | null>;   // manual provider: none; seller responds via link
}

// bio_code: YouTube channels checked automatically via the YouTube Data API (API key, public
// channel description); Instagram/Facebook checked by an admin. OAuth verifiers come later (F4).
interface ChannelVerifier { method: 'bio_code'; start(ch): Promise<Challenge>; check(ch): Promise<VerificationResult> }
interface FingerprintScreener { id: 'acrcloud' | 'fake'; screen(masterKey: string): Promise<ScreeningResult>; addReference(versionId: string, masterKey: string): Promise<void> }
interface PaymentGateway { createOrder; verifyCallbackSignature; verifyWebhook; fetchPayment; refund }   // Razorpay
interface PayoutRail { id: 'razorpayx' | 'bank_file'; submit(batch): Promise<RailSubmission>; status?(payout) }
interface EInvoiceProvider { /* defined, not implemented — F6 */ }
```

Provider selection is by config per platform/class. When a real Content ID or Rights Manager path becomes available, the change is: implement the interface, add the provider id to the `clearance_requests.provider` check, route by config. Licenses, orders, disputes and the admin queue are untouched.

---

## 12. Milestones

Two build sessions. Each milestone ends with its exit criteria green in CI. Session 3 builds the financial and legal core with only the UI needed to run the golden path end to end; Session 4 builds the product surface on top.

### Session 3 — foundation, licensing engine, checkout, ledger, clearance adapters

| ID | Milestone | Scope | Exit criteria |
|---|---|---|---|
| S3-M0 | Scaffold | npm, Next.js 16 + React 19.2, TS strict, Tailwind v4 + shadcn/ui, ESLint 9 with the `lib/*/internal/**` boundary rule, Supabase project + local Supabase CLI stack, Drizzle + migrations (`DIRECT_URL`), RLS-on-every-table migration helper + test, `lib/platform/*` (env via zod, db, Supabase clients, storage, task runner with `after()` + sweep, crypto, rate limit), outbox + Resend sender, audit log with append-only trigger, `vercel.json` crons, `ci.yml` and `vercel-deploy.yml` matching BigSocials, `.env.local.example`. | CI green (env guard, tsc, ESLint, Vitest, `npm audit`, `next build`); a sample task runs via `after()` and via the sweep exactly once; audit_log UPDATE/DELETE rejected by DB; test fails if any table lacks RLS. |
| S3-M1 | Identity & legal | Supabase Auth (email OTP, phone OTP via MSG91, Google OAuth, TOTP MFA), `proxy.ts` session refresh, users/orgs/memberships tables, roles and admin permissions, legal documents + acceptance gate, re-acceptance on new version. | Integration tests: unverified user blocked; admin session at AAL1 blocked; checkout blocked until current ToS accepted; acceptance row has version/ip/timestamp. |
| S3-M2 | Catalog backend | Track/version schema and state machine, signed Storage upload, `ingest` handler (ffmpeg-static: ffprobe, sha256, watermarked preview, preview download, MP3, waveform) within the function time limit, document validation (F9), `FingerprintScreener` (ACRCloud + fake), claim probe + class assignment, publish, seed script. Minimal admin approve/reject page. | Transition-table tests cover every allowed and every disallowed transition; ingest of a 15-min WAV fixture produces a preview with audible tag on a Vercel preview deployment inside `maxDuration`; a renamed executable posing as PDF is rejected; screening match blocks approve without override note. |
| S3-M3 | Pricing & licensing engine | Price books, license terms versions, availability rules (§6.1), license issuance, `public_id`, record hash (JCS + SHA-256), license state machine, expiry sweep, cap enforcement for channels/videos. | Golden-vector test for record hash; cap tests; expired paid-ad license resolves as expired; terms version pinned on license even after a new version is published. |
| S3-M4 | Checkout, payments, invoicing, certificates | Order state machine, `createOrder` with idempotency key, Razorpay adapter, webhook route (raw-body HMAC, event dedupe), callback verification, `markPaid` CAS, `fulfil` handler (§5.2), GST calc, invoice series/numbering, invoice + certificate + dispute-kit PDFs, QR, verify page, clean-file signed download, reconciliation cron and lazy expiry. Bare track page + checkout page + buyer license page. | Tests: duplicate webhook ⇒ one license/invoice/ledger entry; callback and webhook racing ⇒ one fulfilment; amount mismatch ⇒ not paid; late capture on expired order ⇒ fulfilled; crash between fulfilment steps ⇒ retry completes; invoice numbers gap-free under concurrent orders; intra/inter-state GST table tests. Playwright golden path in Razorpay test mode: browse → buy → certificate → verify page. |
| S3-M5 | Ledger, refunds, payouts | Ledger entries + hold, refunds (Razorpay + credit note + license revoke + reversal), chargebacks, clawback via negative balance, payout compute (TDS/GST config), `PayoutRail` (bank_file first, RazorpayX second), statements. | Tests: royalty unavailable before 30 days; refund after payout ⇒ negative balance netted next run; payout idempotency; refund cannot exceed order total; credit note numbering. |
| S3-M6 | Clearance & disputes backend | `ClearanceProvider` + `ManualSellerClearanceProvider`, tokenised seller response link, `ChannelVerifier` (bio_code), video registration → clearance requests, overdue sweep, dispute model + timers + refund eligibility, copyright complaint intake, enquiry form. | Tests: Class A license ⇒ `not_required`; Class B ⇒ request per channel and per registered video; overdue after due_at; dispute on a Class A/B track gets a 48h resolution due, on a track since reclassified C none; refund_eligible after window; response token single-use and expiring. |

### Session 4 — product surface

| ID | Milestone | Scope | Exit criteria |
|---|---|---|---|
| S4-M7 | Seller portal | Onboarding (profile, KYC docs, PAN, bank account with TOTP, seller agreement, release commitment for Class B), upload form, track list/detail, rejection reason + resubmit, new version upload, delist, sales table, payout statements, CSV export, clearance requests inbox. | Playwright: artist onboards, uploads, resubmits after rejection; seller sees only own data (authorisation test). |
| S4-M8 | Discovery | Catalog browse, faceted search (genre, mood, language incl. instrumental, BPM range, price level, tier availability as "media type", duration), Postgres FTS + trigram ranking (relevance, then sales, then recency), waveform player with signed preview URLs, SEO track pages + sitemap, alternative suggestions (same genre, mood overlap, BPM ±10, lower price level, tier available), Commercial/Broadcast enquiry form. | Search returns expected fixtures per facet; suggestions never include the same track or unavailable tiers; player works on mobile and via keyboard. |
| S4-M9 | Buyer dashboard | Licenses list (client-name filter), license detail, channel verification (bio-code), video registration, downloads, invoices/credit notes, dispute reporting and status, verify-display opt-in. | Playwright: buyer registers video beyond cap ⇒ blocked with message; dispute submitted shows due dates. |
| S4-M10 | Admin console | All screens in §9, concierge import tool, impersonation banner. | Every admin mutation produces an audit entry (test iterates the action list); permission matrix test. |
| S4-M11 | Hardening | Rate limits on all public endpoints, WCAG 2.1 AA pass (axe in Playwright), mobile layouts, alert wiring, storage-backup cron verified, restore drill run and documented, extra e2e coverage. | axe zero serious violations on key pages; restore drill result recorded in `docs/`. |

Phase 5 (Review) follows Session 4.

---

## 13. New working assumptions introduced by this plan

These were not settled by the locked decisions and are needed to build. All are reversible configuration or copy, not architecture. **All accepted by the owner on 2026-11-12** (items marked [Lawyer]/[CA] still need professional confirmation of the value).

1. Platform owns pricing via a versioned price grid (price level × tier); seller proposes a level, admin assigns it. Seller royalty is a contract percentage of the taxable value.
2. Price book amounts are GST-exclusive; checkout shows the GST breakdown and total.
3. A "video" is one creative; cross-posts and cut-downs of the same creative count once.
4. Paid Ad tier has no creative cap within its 12-month term; every YouTube creative must be registered for clearance.
5. Creator tier covers organic, non-sponsored content; sponsored content requires Brand Organic.
6. Up to 3 channels per license; up to 2 channel corrections before videos are registered.
7. Claim-release refund window 7 days from dispute open (config; accepted by owner 2026-11-12, lawyer to confirm) **[Lawyer]**.
8. Seller clearance turnaround default 1 business day (seller contract, config).
9. Territory is worldwide for online use; tracks without worldwide rights are not accepted.
10. Commercial/Broadcast deals are handled offline with no license record in MVP.
11. Paid-ad renewal is a new purchase at the then-current price; reminders at 30 and 7 days; no auto-renew.
12. Full refunds only; no partial refunds.
13. Clean-file downloads: original master + MP3 320; 20 downloads per license, signed 15-min URLs; stems out of scope.
14. Individual licensees are shown masked on the verify page unless they opt in.
15. Channel verification by bio-code in MVP (F4).
16. Language list adds "Instrumental" (critique §3).
