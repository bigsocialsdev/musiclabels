# Project State — Music Rights Marketplace

Last updated: 2026-11-12

## Current Phase
Phase 3 — Plan (Architect): outputs written (docs/PLAN.md, root CLAUDE.md) — awaiting [GATE] review by user. Phase 4 (Build) not started.

## Milestone Status
| Phase | Status |
|---|---|
| 1. Understand | Done — docs/PRD-analysis.md written; open questions resolved via assumptions |
| 2. Critique | Done — docs/PRD-critique.md written; all recommendations ACCEPTED by user (2026-11-11) |
| 3. Plan | Done pending [GATE] — docs/PLAN.md + CLAUDE.md written (2026-11-12) |
| 4. Build | In progress — S3-M0 merged, S3-M1 in PR (see changelog); next S3-M2 |
| 5. Review | Not started |

## Decisions Made
User instruction (2026-11-11): proceed with reasonable assumptions on all 15 open questions rather than answering individually; assumptions are FLAGGED FOR REVIEW, not final-approved. Revisit at Phase 3 [GATE] or sooner if any assumption proves materially wrong.

### Working assumptions (supersede docs/PRD-analysis.md §7 where overlapping) — ⚠️ UNREVIEWED, pending user confirmation
1. **Content ID / Rights Manager access:** Not yet secured. MVP ships with an adapter layer + manual/admin-assisted whitelisting fallback; automated API path is wired but treated as "enable when partner access is granted." Flagged as a business-development dependency outside engineering's control.
2. **Watermarking:** Audible/deterrent watermark on preview streams only (no forensic vendor for MVP, avoids vendor lock-in/cost). Buyer receives a clean (unwatermarked) downloadable file only after successful checkout.
3. **Royalty splits:** Seller can attach co-rightsholder splits (name + percentage, must total 100%) for ledger transparency. MVP pays out only to the primary seller account; platform does not auto-split payouts to co-rightsholders' own bank accounts — deferred post-MVP.
4. **Admin rejection:** Admin must give a free-text reason; track enters "rejected" state (editable), seller may resubmit unlimited times.
5. **Exclusivity:** Non-exclusive by default — same track/tier can be sold to multiple buyers concurrently (standard sync-marketplace model). No exclusive-license option in MVP.
6. **Expiration:** Licenses are perpetual for the purchased scope; no auto-expiry. Revocation only via admin action (fraud/dispute).
7. **Refunds:** No refunds after certificate issuance except platform-caused error (e.g., invalid rights discovered later) — then refund + license revocation.
8. **Liability:** Platform's obligation is limited to best-effort dispute release within the 24–48h SLA; no monetary compensation guarantee if a strike recurs or isn't resolved.
9. **MVP scope:** Hindi, Punjabi, Tamil, English are the full MVP language set (others added post-launch); genre taxonomy is a fixed admin-defined list (~15–20 genres), not open-ended tagging.
10. **Agency billing:** Single consolidated invoice per agency workspace, with per-client line-item breakdown. Separate per-client invoicing deferred.
11. **Geography:** India-only MVP (INR, GST, UPI/Netbanking, Indian bank payout rails). International buyers/sellers out of scope for MVP.
12. **Ownership fraud:** Seller must submit a signed self-declaration/indemnity plus at least one supporting document (PRO registration, distribution/publishing agreement, or similar). Admin does reasonable-effort review, not forensic verification; seller bears contractual indemnity for false claims.
13. **Whitelisting granularity:** Per-channel / per-ad-account whitelisting scoped to the licensed track (not per-video-URL), submitted at checkout before the buyer publishes.
14. **SLA escalation:** Missed 24–48h SLA auto-escalates to a priority admin queue + notifies the buyer; tracked as an internal ops metric. No automatic financial penalty in MVP.
15. **GST/TCS:** All tiers, including Creator/Personal, receive a GST-compliant invoice (platform treated as e-commerce operator/marketplace facilitator under Indian GST law, likely liable for TCS regardless of buyer type); Creator-tier invoices marked B2C.

## Decisions Made (cont.)
User instruction (2026-11-11): ACCEPT ALL recommendations in docs/PRD-critique.md. These are now locked decisions for Phase 3 (Architect), superseding the raw assumptions where they conflict:
- **Principal/sub-licensor model** (not marketplace/agent model) — platform issues every license and every invoice in its own name; sellers grant platform a non-exclusive, sub-licensable right.
- **Catalog policy:** only "Class A" (unregistered in any fingerprint system) and "Class B" (seller controls their own Content ID/Rights Manager registration, contractually commits to releasing claims) tracks accepted at launch. "Class C" (registered elsewhere, no release path) rejected.
- **License term:** perpetual for organic tiers (Creator/Personal, Brand Organic); fixed 12-month renewable term for Paid Ad Campaign. Commercial/Broadcast moved to enquiry-only (not self-serve, not perpetual — negotiated per deal).
- **Refund/liability:** refund buyer if a claim from a cataloged rightsholder isn't released within a fixed window; platform liability capped at fees paid; funded by a 30-day seller payout hold (replaces on-demand withdrawal).
- **Content ID/Rights Manager:** NO direct API integration in MVP (no partner access, no sandbox exists for non-partners). Replaced by: manual seller-clearance workflow (classify tracks, clearance request to seller, track turnaround) + buyer "dispute kit" (certificate + license text + suggested dispute wording). Intermediary partnership (AdRev/Symphonic-type) tracked as a parallel business-development item, not engineering scope.
- **Commercial/Broadcast tier:** enquiry form only, not self-serve checkout.
- **Royalty splits:** no split-payout automation; one payee (primary seller) per track with a co-owner consent warranty; no split UI in MVP.
- **Watermarking:** audible-only tag rendered once at ingest (confirmed, not forensic).
- **Discovery "alternative suggestions":** metadata-based (genre/mood/BPM/price), not ML acoustic-similarity.
- **Agency multi-client workspace:** deferred to V2; MVP = a "client name" field on orders (prints on certificate/invoice).
- **Checkout:** single-track only — no cart, no upgrades, no coupons, no exclusive licenses.
- **Label onboarding:** concierge/admin-assisted bulk import; self-serve upload for individual artists only.
- **Dispute SLA:** reworded to "first action within 1 business day"; resolution target 48h for Class A/B tracks only (backed by seller contract); no blanket promise for third-party claims.
- **Do-not-cut floor:** fingerprint screening of uploads, versioned ToS acceptance w/ audit trail, idempotent payment handling with an order state machine, full admin console (verification/clearance/dispute/refund/payout), backups, third-party copyright complaint process — all remain in MVP scope.

## Blockers
(none — proceeding into Phase 3)

## Decisions Made (cont. 2)
User instruction (2026-11-12): confirmed Phase 3 retry #2 (fable/medium) produced no output — treated as abandoned, not resumed. New Phase 3 session started at Opus/High, scoped to Plan only (reads locked docs/PRD-critique.md decisions as final input; does not re-run critique).

## Phase 2 critique — key findings (full detail in docs/PRD-critique.md)
The critic (fable/high) found the PRD's core promise is **not buildable as specified**: direct YouTube Content ID / Meta Rights Manager API access is realistically unobtainable for a new entrant (gated, invite-only programs); per-channel "whitelisting scoped to one track" isn't a primitive these platforms offer (allowlists are per-channel, catalog-wide); the 24-48h dispute SLA is false as a blanket promise (third-party claims run 7-30 day clocks); and the principal-vs-marketplace question (does the platform sell the license itself, or just host sellers?) is undecided and drives invoicing/GST/TCS/payouts/RBI payment-aggregator exposure.

### 5 forcing decisions needed before Phase 3 (Architect)
1. **Principal vs. marketplace model** — recommended: platform acts as principal/sub-licensor (sellers grant it a sub-licensable right; platform issues every license+invoice itself). Simplifies GST/TCS and avoids RBI payment-aggregator licensing. Alternative: true marketplace (seller is licensor) needs RBI PA authorization + per-seller GST handling.
2. **Catalog policy** — recommended: launch with only "Class A" (unregistered in any fingerprint system) and "Class B" (seller controls their own Content ID/Rights Manager registration and contractually commits to releasing claims) tracks; reject "Class C" (registered elsewhere, no release path).
3. **License term per tier** — recommended: perpetual for organic tiers (Creator/Brand Organic), fixed 12-month renewable term for Paid Ad Campaign; drop "perpetual" for paid ads.
4. **Refund/liability position** — recommended: refund if a claim from a cataloged rightsholder isn't released within a fixed window; liability capped at fees paid; funded by a 30-day payout hold (not on-demand withdrawal).
5. **Content ID/Rights Manager strategy** — recommended: drop direct API integration entirely for MVP (no sandbox exists for non-partners); replace with manual seller-clearance workflow + buyer "dispute kit"; pursue an intermediary partnership (AdRev/Symphonic/etc.) as a parallel business-development track, not an engineering task.

### Other major recommended scope cuts (full list: docs/PRD-critique.md §6)
- Commercial/Broadcast tier → enquiry form, not self-serve checkout (needs negotiated/exclusive terms).
- Drop royalty-split payouts (keep splits display-only or cut entirely) — consent/legal issue, not arithmetic.
- Audible-only watermark (already assumed) — confirmed correct, forensic watermarking adds no value since published videos expose audio anyway.
- Cut acoustic-similarity ML; use genre/mood/BPM/price metadata matching instead.
- Defer agency multi-client workspace to V2; MVP = simple "client name" field on orders.
- Single-track checkout only (no cart/upgrades/coupons/exclusive licenses) for MVP.
- Concierge/bulk onboarding for labels (admin-assisted), self-serve only for individual artists.

### Do-not-cut (critic's floor for MVP)
Fingerprint screening of uploads, versioned ToS acceptance w/ audit trail, idempotent payment handling with an order state machine, full admin console (verification/clearance/dispute/refund/payout), backups, third-party copyright complaint process.

## Changelog — Phase 3 (Architect), 2026-11-12, Opus/High
Produced:
- **docs/PLAN.md** — modular-monolith architecture (Next.js + Postgres + pg-boss worker, AWS ap-south-1), 19 modules, full data model, state machines (track, clearance class, order, license, clearance request, dispute, payout), checkout/fulfilment flow, licensing tiers, certificate/verify/record-hash design, Razorpay/GST/ledger/payout design, admin console, adapter interfaces (ClearanceProvider etc.), milestones S3-M0..M6 (Session 3) and S4-M7..M11 (Session 4).
- **CLAUDE.md** (repo root) — stack, code shape, invariants (money, state machines, payment idempotency, record hash, GST numbering, append-only tables, security), MVP scope boundaries.

No locked decision was found infeasible. Eight feasibility flags need owner confirmation (detail: PLAN §1):
- F1: 48h resolution for **Class A** cannot be seller-backed (a claim on Class A means a third party registered it); "resolution" defined as claimant identified + release or move to refund track.
- F2: 30-day hold only funds early refunds; later refunds are clawed back from future royalties (negative balance) under seller indemnity.
- F3: fingerprint screening needs a vendor contract (ACRCloud working choice); manual claim probe is the fallback.
- F4: OAuth channel verification needs Google sensitive-scope verification / Meta App Review → MVP uses bio-code verification.
- F5: GST reverse charge on composer royalties, forward GST for registered sellers, TDS rates → config fields **[CA]**.
- F6: e-invoicing (IRN) slot designed, not built, until turnover threshold.
- F7: RazorpayX needs its own account → bank bulk-file payout rail ships first.
- F8: "GST/TCS as e-commerce operator" (A15) conflicts with the locked principal model → plan follows principal model: platform GST on full value, **no TCS**. [CA] sign-off.

Interpretation of locked decisions: "cryptographic verification hash" kept as a SHA-256 record hash over canonical JSON of immutable license fields (integrity check shown on the verify page), with long random license ID + server-side verify page as the source of truth (critique cut 13); no signing key. Adapter layer = interfaces with only implementations that run in production (no dormant Content ID code, per critique C14).

New working assumptions (accepted 2026-11-12, see review decisions below; full list PLAN §13): platform-owned price grid (price level × tier) with seller royalty as contract % of taxable value; prices GST-exclusive; "video" = one creative (cross-posts/cut-downs count once); paid-ad tier uncapped creatives within 12 months; Creator = non-sponsored organic; ≤3 channels per license; refund window 7 days (config, [Lawyer]); seller clearance turnaround 1 business day; worldwide territory required; Commercial/Broadcast handled offline with no license record; paid-ad renewal = new purchase; full refunds only; 20 downloads/license; masked individual licensee names on verify page; "Instrumental" added to languages.

### Phase 3 revision, 2026-11-12: tech stack aligned to BigSocials
User instruction: follow the team's existing BigSocials stack (`BigSocials-Tech-Stack.docx`, main @ 486cc1fa). PLAN §2 and CLAUDE.md rewritten accordingly. AWS (ECS/RDS/S3/CloudFront/SES), Better Auth, pg-boss, ClamAV, pnpm and Sentry are replaced by: Next.js 16 on Vercel + Vercel Cron, Supabase (Postgres with RLS on every table, Auth with email/phone OTP + Google + TOTP MFA, Storage), Drizzle, Resend, MSG91, npm, and `lib/<slice>` barrels with an ESLint boundary rule. Background work is now "state is the queue": `after()` plus cron sweeps instead of a worker. Razorpay stays, but without the escrow/split settlement BigSocials uses, because the locked principal model has the platform as supplier.
Deliberate departures from BigSocials: Node 22 (Node 20 is end-of-life); no pgvector/LLM/Web Push/Instagram Graph; off-site Storage backup bucket.
New flags (PLAN §1):
- F9: ClamAV can't run on Vercel → malware scan replaced by strict type/magic-byte validation + attachment-only admin downloads. Departs from the critique's malware-scan requirement; **ACCEPTED by user 2026-11-12** (a hosted scan API can be added later at the validation step).
- F10: 10-min and hourly crons need Vercel Pro (BigSocials crons are all daily). Without Pro, retries and overdue notices lag up to a day.
- F11: Supabase backups exclude Storage → daily copy to an off-site bucket (R2 or S3); PITR add-on on production.
### Phase 3 review decisions, 2026-11-12 (user)
- **F1 ACCEPTED:** for Class A, "resolved within 48h" = claimant identified + seller notified + release obtained or dispute moved to the refund track.
- **F10 DECIDED: daily crons only for now.** ⚠️ REVISIT LATER in the build cycle: sub-daily `tasks-sweep` (10 min) and `timers` (hourly) need Vercel Pro and are a `vercel.json` change only. Until then, `after()` is the primary trigger, admins have a re-run action, and failed retries or overdue notices may lag up to a day.
- **F11 DECIDED:** off-site Storage backup goes to **Cloudflare R2**.
- **Refund window ACCEPTED: 7 days** from dispute open (still [Lawyer] to confirm).
- **PLAN §13 assumptions ALL ACCEPTED:** platform price grid (level × tier, seller royalty = contract % of pre-GST value); prices shown pre-GST with breakdown at checkout; "video" = one creative; paid-ad tier uncapped creatives (each YouTube creative registered); sponsored content needs Brand Organic; tracks without worldwide rights rejected; ≤3 channels + 2 corrections; full refunds only; paid-ad renewal = new purchase, no auto-renew; Commercial/Broadcast handled offline; master + MP3 320, 20 downloads per license; masked individual names on verify page; seller turnaround 1 business day.
- Still open: F2, F3, F5–F8. These are mostly external dependencies (CA, lawyer, ACRCloud contract, RazorpayX account) and don't block the build: the plan holds their values as config.

F4 updated: YouTube bio-codes are checked automatically via the YouTube Data API key; Instagram/Facebook are checked by an admin.

## Changelog — Phase 4 (Build)

### S3-M0 Scaffold, 2026-11-12 (Sonnet)
Built: Next.js 16 + React 19 + TS strict + Tailwind v4 skeleton (`components.json` for shadcn; components added on first use); ESLint 9 flat config with the `lib/<slice>/internal/**` boundary rule (slices discovered from `lib/` directories; verified it blocks cross-slice and allows own-slice imports); Supabase CLI project (`supabase/`) + Drizzle (`db/schema.ts`, migrations via `DIRECT_URL`); `lib/platform/*` (zod env validated lazily, db with `DbOrTx`, service-role Supabase client, storage signed-URL wrappers, AES-256-GCM crypto with key ids, `after()` task `kick` + secret check for `app/api/tasks|cron`, Postgres token-bucket rate limit, UUIDv7, JSON logs); `notifications` slice (outbox enqueue-in-transaction, claim via `FOR UPDATE SKIP LOCKED`, stale-claim reclaim, 5 attempts, Resend sender with idempotency key); `audit` slice (`writeAudit(tx, …)`); migrations: `0000_foundation` (audit_log, outbox, rate_limits, RLS on) and `0001_append_only_triggers` (`mrm_append_only('table')` helper applied to audit_log: UPDATE/DELETE/TRUNCATE rejected); `vercel.json` crons (tasks-sweep, rate-limit-cleanup, daily), `ci.yml`, `vercel-deploy.yml`, `.env.local.example`; Playwright config + smoke spec.
Tests (real Postgres): audit append-only, RLS-on-every-table (fails if a public table lacks RLS or any policy exists), outbox exactly-once under after()/sweep race, rate limit atomicity/refill, crypto, env, secrets.
Assumptions / deviations:
- Per-milestone env: `lib/platform/env.ts` holds only what M0 uses; Razorpay/MSG91/ACRCloud/YouTube/R2 and the **[CA]/[Lawyer]** config values are added by the milestone that uses them.
- Cookie-based Supabase SSR clients and `proxy.ts` ship with S3-M1 (Auth), not M0. TanStack Query, React Hook Form, next-themes, Chart.js likewise on first use.
- Only existing crons are in `vercel.json`; the rest (reconcile, payouts, timers, …) are registered with their milestones.
- `mrm_append_only(tbl)` SQL helper is the mechanism for the append-only list in CLAUDE.md; later migrations call it per table.
- CI starts only the Supabase Postgres container (`supabase start -x …`); M1 will need `auth` schema, so that exclude list must drop `gotrue` then. CI is green on GitHub (PR #1); Supabase CLI comes from `supabase/setup-cli`, not an npm dependency. `vercel-deploy.yml` fails until `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` repo secrets exist. Lockfile gotcha: regenerate `package-lock.json` in a clean directory (no `node_modules`) with npm 11, otherwise npm records only the local platform's optional binaries and Linux `npm ci` breaks.
- Versions follow PLAN (TS 5, ESLint 9, Vitest 4, Node 22) rather than newest majors.

### S3-M1 Identity & legal, 2026-11-12 (Sonnet)
Built: tables `users`, `organizations`, `memberships`, `legal_documents`, `acceptances` (RLS on; the last two append-only via `mrm_append_only`). `identity` slice: `loadSession` (user validated by Supabase `getUser`, AAL from verified `getClaims`), `requireVerified` / `requireAal2` / `requireAdmin(permission)` (role and permissions read from the DB each call; superadmin implies all; AAL2 required for admins), `ensureUser`, `createOrganization` (org + owner membership in one transaction), `getMembershipRole`, `safeNext` (open-redirect guard), MSG91 phone-OTP via Supabase "Send SMS" hook (`/api/auth/sms-hook`: Standard Webhooks signature, +91 numbers only). `legal` slice: `publishLegalDocument` (superadmin, consecutive versions under an advisory lock, sha256, audit row in the same transaction), `getCurrentDocument`, `recordAcceptance` (idempotent per user and version), `checkAcceptance` (the gate; re-gates on a new version; fails closed when nothing is published). Pages: `/auth/sign-in` (email OTP, phone OTP, Google), `/auth/mfa` (TOTP enrol/verify), `/auth/callback`, `/legal/accept`; `proxy.ts` refreshes the session; local Supabase TOTP MFA enabled in `supabase/config.toml`.
Tests (real Postgres): admin at AAL1 blocked, unverified/anonymous blocked, role read from DB, org tenant scoping, ToS gate (blocked until accepted, row stores version/ip/time, new version re-gates), append-only, concurrent publishes, hook signature and MSG91 request shape.
Assumptions / deviations:
- No FK from `users.id` to `auth.users`: the row is created by `ensureUser` after sign-in (sign-in form action and OAuth callback), so the app schema does not depend on Supabase's auth schema and CI keeps starting only Postgres.
- `acceptances.org_id` is nullable (a user can accept before they have an org); unique per (user, document).
- "Checkout blocked until ToS accepted" is `checkAcceptance(db, userId, ['tos'])`; M4's `createOrder` must call it. Admin pages must call `requireAdmin` (no route gating in `proxy.ts`, by design).
- Impersonation stays in S4-M10. GSTIN validation is not in M1 (arrives with GST, M4/M7).
- **Not verified end to end**: the auth UI, Supabase cookie session and TOTP flows, Google OAuth and the MSG91 call need a running Supabase Auth stack plus MSG91/Google credentials and were not exercised here (guards and gate are tested with session objects). MSG91's OTP endpoint parameters are from its docs, untested against a live DLT template. Needs a manual pass with `supabase start` (full stack) before launch; hosted setup: enable the Send SMS hook, Google provider and TOTP in the Supabase dashboard.
- Dev environment note: Docker was unavailable on the build machine, so local tests ran on a standalone Postgres on port 54322; CI uses the Supabase Postgres container.

## Notes
- docs/PRD.md created from "Simple PRD - Music Rights Marketplace.pdf" supplied by the user.
- docs/PRD-analysis.md written by Phase 1 "PRD analyst" sub-agent (sonnet/medium): covers actors, module breakdown w/ ambiguities, 16 proposed data entities, 6 user flows, integration risk table, non-functional needs, 9 explicit assumptions, 15 open questions.
- Orchestrator rules: never code or plan directly; delegate via sub-agents; hand off through files only; stop at every [GATE].
