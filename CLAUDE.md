# Music Rights Marketplace — build rules

India-only sync-licensing storefront. The platform is the **principal sub-licensor**: it sells every license and issues every GST invoice in its own name, then pays sellers a royalty. Design lives in `docs/PLAN.md`; locked product decisions in `docs/STATE.md`. Read the PLAN section for the module you are touching before writing code. If a task seems to need a change to a locked decision, stop and ask; record any new decision in `docs/STATE.md`.

## Stack

Same stack as the team's BigSocials app: Next.js 16 App Router + React 19.2 · TypeScript strict · Tailwind v4 + shadcn/ui · TanStack Query, React Hook Form + Zod 4 · Supabase (Postgres, Auth, Storage; Mumbai) · Drizzle (postgres-js) · Vercel + Vercel Cron · Razorpay · Resend · MSG91 · ffmpeg-static · ACRCloud · `@react-pdf/renderer` · Vitest 4 + Playwright · npm. Why each, and the deliberate departures: PLAN §2.2. Scripts and versions: `package.json`.

Local: Supabase CLI stack (`supabase start`) plus `npm run dev`. Integration tests run against the local Supabase Postgres.

## Code shape

- Modular monolith in `lib/<slice>/`: `index.ts` (safe anywhere), `server.ts` (server-only), implementation in `internal/**`, which ESLint blocks from outside the slice. A slice writes only its own tables (ownership: PLAN §2.3).
- Server actions for mutations; route handlers under `app/api/*` for webhooks, seller clearance links, background tasks and cron. Both stay thin: parse with zod, call one slice function, map the result.
- Background work has no queue: the row's state is the work item (PLAN §2.1). Kick the handler with `after()` once the transaction commits; a cron sweep reruns it for anything left. Every handler claims its row (`FOR UPDATE SKIP LOCKED` or compare-and-set) and is idempotent.
- Emails are outbox rows written in the **same transaction** as the state change they report.
- External services sit behind the adapter interfaces in PLAN §11. Add an implementation only when it will be called in production; leave the interface as the extension point.
- Tests next to code (`*.test.ts`). Money, state machines and webhooks are tested against real Postgres.
- Keep it simple: the smallest change that meets the PLAN; no speculative abstractions.

## Database and Supabase

- Schema in `db/schema.ts`, migrations in `db/migrations` via drizzle-kit (`DIRECT_URL`); the app uses the transaction-mode pooler URL. Change production only through migrations; `db:push` can wipe RLS policies.
- Every table has RLS enabled. Add a policy for `anon`/`authenticated` only when a browser genuinely reads that table through Supabase; app data flows through server-side Drizzle.
- Service-role key, DB URLs, Razorpay secrets and the encryption key are server-only env vars. The browser sees only the Supabase URL and anon key.
- Storage buckets are private; files leave only through short-lived signed URLs.
- Pull requests only; `main` deploys to production.

## Invariants

Hard guardrails. Each has a test; a change that breaks one is wrong even if the feature works.

### Money
- Amounts are integer **paise**: `bigint` in Postgres, integers in code, never floats. Rounding: GST components round half-up per component; royalties round down.
- Every order stores a price/tax/terms **snapshot** at creation. Later code reads the snapshot, never the current price book or terms.
- Royalty base is the taxable value; GST is never part of it.

### State machines (PLAN §4)
- Status changes go through the module's transition table, as a compare-and-set `UPDATE … WHERE id = $1 AND status = $from`. Zero rows updated = someone else won: return current state, do nothing.
- Every transition writes its event row (`order_events`, `dispute_events`, …) and, for admin/system actions, an `audit_log` row in the same transaction.
- Only `published` tracks are sellable. Suspending or delisting a track never touches existing licenses.

### Payments
- Webhooks: verify the HMAC on the **raw** body with a constant-time compare, then insert into `payment_events` keyed by `x-razorpay-event-id`; a duplicate insert is a successful no-op.
- Client callback and webhook both call the same `markPaid` CAS. Mark paid only when captured amount and currency equal the snapshot.
- Fulfilment is the `fulfil` handler for one claimed `paid` order; every step is idempotent and safe to re-run (PLAN §5.2). License, invoice and ledger credit are inserted in one transaction, guarded by unique `order_id`.
- Refunds are full-order only, keyed by a unique refund row, and always produce a credit note, license revocation and ledger reversal together.
- Seller money moves only by the monthly payout run after the 30-day hold. Balances are never withdrawable on demand and never spendable on purchases.

### Licenses and certificates (PLAN §7)
- `public_id` is 128 CSPRNG bits, Crockford base32. Never sequential, never derived.
- `record_hash` = SHA-256 of the RFC 8785 canonical JSON of the fixed field list in PLAN §7, tagged `mrm-license-v1`. Computed once at issuance. The hashed columns are immutable (DB trigger). Adding a field means a new schema tag, never editing v1.
- The verify page reads the database; mutable facts (status, channels, videos) are shown live and stay outside the hash.
- A license pins its terms version and license-text version; code for an existing license reads the pinned versions.
- Rows referenced by a license (track, version, seller, invoice) are never hard-deleted.

### GST (PLAN §8.2)
- Every order gets a tax invoice from the platform; no TCS, no seller-issued invoices.
- Place of supply = GSTIN state code if a GSTIN is given, else the mandatory billing state. Same state as supplier → CGST + SGST; otherwise IGST.
- Invoice and credit-note numbers are allocated from `invoice_series` under `SELECT … FOR UPDATE` inside the issuing transaction: per financial year, consecutive, gap-free, ≤ 16 chars.
- Issued invoices and credit notes are immutable; corrections are credit notes.
- Supplier GSTIN, SAC code, rates, TDS/RCM values and windows are config, marked **[CA]**/**[Lawyer]** in PLAN. Keep them out of code constants.

### Append-only tables
`audit_log`, `acceptances`, `ledger_entries`, `order_events`, `dispute_events`, `legal_documents`, `license_terms_versions`: insert-only, enforced by DB triggers. Corrections are new rows. `invoices` and `credit_notes` are the same for every fiscal column; only `pdf_key` and the e-invoice fields are write-once (null → value). `payment_events` only gains `processed_at`.

### Security and privacy
- Every tenant query is scoped by the caller's org inside the module function; org ids from the client are inputs to check, not trust.
- Admin actions: `requireAdmin(permission)` + MFA (session at AAL2) + `audit_log`. Payout-detail changes require AAL2.
- Rights documents: PDF/JPG/PNG only, magic bytes must match, served to admins as attachment downloads (PLAN F9).
- `app/api/tasks/*` and `app/api/cron/*` require their secret header and accept only an id; they re-read state from the DB.
- PAN and bank account numbers are encrypted at the application layer and displayed masked.
- Secrets come from env (validated by zod in `lib/platform/env.ts`, names in `.env.local.example`); nothing secret in the repo or in logs.
- Product copy and certificates describe clearance as a process; they never promise "zero strikes" or instant protection.

## Scope boundaries for MVP

Single-track checkout (no cart, coupons, upgrades, exclusives) · Commercial/Broadcast is an enquiry form · no Content ID/Rights Manager client · no split payouts (one payee per track) · audible preview watermark only · metadata-based suggestions · agency = `client_name` on orders · email-only notifications · English UI, INR only. Requests beyond this go back to the user before code.
