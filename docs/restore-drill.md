# Backup and restore drill

Targets (PLAN §10): **RPO ≤ 2 minutes** for the database (point-in-time recovery), **RTO 4 hours** for a full recovery. Run the drill **quarterly** and after any change to backups. Record each run in the results log at the bottom.

## What is protected, and by what

| Data | Where it lives | Backup | Restore |
|---|---|---|---|
| Postgres (orders, licenses, invoices, ledger, audit, accounts) | Supabase, Mumbai | Supabase daily backups plus the **PITR add-on** (production project) | Restore into a **new** Supabase project |
| Storage: masters, rights documents, PDFs (certificates, invoices, credit notes, statements) | Supabase Storage buckets `masters`, `documents`, `pdfs` | Daily `storage-backup` cron (`/api/cron/storage-backup`, 04:00 UTC) copies new and changed objects to a Cloudflare R2 bucket and records each in `storage_backups` with the MD5 R2 confirmed | `npm run restore:drill -- --restore-storage` |
| Previews and waveforms | Storage bucket `previews` | Not copied: rebuilt from the masters by the ingest handler | Re-run ingest |
| Code and migrations | GitHub | Git | Redeploy |
| Secrets (Razorpay, Resend, encryption keys…) | Vercel env | Owner's password manager | Re-enter. **Without `ENCRYPTION_KEYS` the encrypted PAN and bank numbers cannot be read: keep them out of the same place as the database backup.** |

The cron never deletes off-site: an object removed from Storage stays restorable. A changed object overwrites its copy (R2 has no versioning); masters and documents are written once under new keys, so this affects only regenerated PDFs.

## Keeping the off-site copy safe

The `documents` bucket holds KYC documents (PAN cards, identity and bank proofs) and rights documents, so the off-site bucket holds them too. Keep the R2 bucket **private** (no public access, no custom domain), scope the API token to that one bucket, and keep its keys only in Vercel and the owner's password manager. Deleting a record in the app does not delete its off-site copy (backups are append-only by design); a deletion request under the DPDP Act needs the lawyer's view on backup retention **[Lawyer]**.

## Before the first drill: one-time setup (owner)

1. Cloudflare R2: create a bucket and an API token limited to it (Object Read and Write). Set `BACKUP_S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` in Vercel (Production). Until all four are set the cron fails daily and raises a `cron_failure` ops alert, which is the intended reminder.
2. Supabase: enable the PITR add-on on the production project (paid plan).
3. Run the cron once by hand (`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/storage-backup`) and check `/admin/alerts` stays quiet and the response shows `copied` and `remaining: 0`. A large first backlog drains over several daily runs (each run stops at a 4-minute budget; `remaining` says how many are left).

## Drill procedure

Time each step; the total is the measured RTO.

1. **Pick the restore point.** Supabase dashboard → Database → Backups: choose PITR "5 minutes ago" for the drill (and note the timestamp).
2. **Restore into a new project** (never over production). Note the new project's URL, service-role key and pooler connection string. Record the elapsed time.
3. **Database checks.** From a checkout of `main`, with `DATABASE_URL` set to the restored database's pooler URL (never production's):
   ```bash
   npm run restore:drill -- --db-only
   ```
   It confirms the migrations the repository expects are applied, RLS is on for every table, the append-only triggers exist, invoice and credit-note numbers have no gaps, every fulfilled order has its license and invoice, and the record hash of the licenses recomputes (`--all` for every license; the default samples the 100 newest).
4. **Storage restore.** Create the three private buckets in the restored project (names as in `lib/platform/storage.ts`), then, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set to the **restored** project and the `BACKUP_S3_*` values:
   ```bash
   npm run restore:drill -- --restore-storage --target-host <restored-ref>.supabase.co --all
   ```
   Every manifest object is read from R2, checked against the recorded MD5, uploaded and read back. For a rehearsal use `--sample 200` instead of `--all`. `--target-host` must equal the host in `NEXT_PUBLIC_SUPABASE_URL`: it is the guard against writing into production.
5. **Storage verification without restoring** (cheap, can run any week): `npm run restore:drill -- --storage-only --sample 200`. Checks that off-site objects exist, match the manifest, that every sampled master hashes to the SHA-256 the database holds, and that Storage has no objects waiting for a copy.
6. **Smoke test the restored project**: point a preview deployment at it, open a license's verify page and download a certificate and an invoice from a buyer account.
7. **Record the result** below (paste the script output), with the timings and anything that needed a manual fix. Delete the restored project.

A real recovery is the same steps with production traffic pointed at the restored project once step 6 passes (update the Vercel env, Supabase Auth redirect URLs, Razorpay and Supabase webhook URLs).

## Results log

### 2026-11-14: rehearsal on the local stack (not a production restore)

What this is and is not: the first drill could not be a production one. The production R2 bucket, its keys and the PITR add-on are not set up yet (see STATE, S4-M11), and the machine used has no Postgres client tools (`pg_dump`). So this entry checks the **drill tooling** end to end against a local database and a stand-in off-site store; it does **not** show that a Supabase backup restores, or measure RTO. **The first real drill is still to be run** once the setup above is done, and its result should be added below.

Command: `npm run restore:drill -- --db-only --all` against the local test database after a full test-suite run (182 licenses, many orders and ledger entries).

```
**Database** (0.3 s)
- PASS migrations: 22 applied, as the repository expects
- PASS row-level security: every public table has RLS enabled
- PASS append-only triggers: 7 append-only tables are guarded
- FAIL gap-free numbering: credit_note 3370-01: 1 numbers allocated, 0 issued; invoice 3370-01: 12 numbers allocated, 0 issued; invoice 5349-01: 1 numbers allocated, 0 issued; invoice 5720-01: 2 numbers allocated, 0 issued
- PASS fulfilled orders: every fulfilled order has its license and invoice
- PASS license record hashes: 182 licenses recomputed, all match
```

The four numbering lines are test residue, not a defect: the invoicing tests allocate numbers in invented financial years (3370, 5349, 5720) without issuing documents. A real database has no such series, so this check is expected to pass there; it did detect the residue, which is what it is for. The storage half (off-site read-back, MD5 and master SHA-256 checks, restore into a Storage project) is covered by the automated tests against stand-in stores and has not run against R2 or a live Supabase Storage. Measured recovery time: not available from a rehearsal.

### First production drill: not yet run
Waiting for: R2 bucket and keys, PITR enabled, one successful `storage-backup` run.
