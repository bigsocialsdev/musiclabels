/**
 * Concierge catalog import (PLAN §5.1): a label's CSV of metadata plus a local folder of masters and rights
 * documents become tracks under the label's seller organisation, submitted for the normal pipeline
 * (ingest, screening, claim probe, admin review). Tracks stay `submitted`: the cron sweep finishes screening and moves
 * them to the review queue. Nothing is published by this script.
 *
 *   npm run import:catalog -- --csv tracks.csv --files ./masters --org <seller org id> --user <member user id> --admin <admin user id> --dry-run
 *   npm run import:catalog -- --csv tracks.csv --files ./masters --org <seller org id> --user <member user id> --admin <admin user id> --confirm-warranties
 *
 * `--admin` is the operator running the import: an admin with the `verification` permission (PLAN §9). Every imported
 * track and the run itself are written to `audit_log` under that admin. The script cannot check the admin's MFA
 * session: whoever holds the database and Storage credentials is trusted to run it.
 * `--user` is a signed-up member of the label's organisation; the import acts as them, so every seller-side
 * guard applies (onboarding done, seller agreement accepted, KYC not rejected). Re-running skips tracks the
 * organisation already has with the same title and primary artist, including a draft left by a row that failed
 * halfway: the label finishes or deletes that draft from its dashboard. `--dry-run` checks the CSV, genre and
 * mood names, that the named files exist, duplicates and the seller's standing, without writing or uploading;
 * the audio format and the document's real type are only checked at ingest and upload. Needs DATABASE_URL, the Supabase URL and service-role key, and ffmpeg (ingest).
 *
 * CSV columns (header row, `;` separates list values, yes/no for flags):
 *   title, primary_artist, language (hindi|punjabi|tamil|english|instrumental), master_file, rights_document  (required)
 *   rights_doc_type, featured_artists, composers, lyricists, genre, moods, bpm, explicit, ai_generated,
 *   organic_social, paid_ads, edits_allowed, price_level (L1..L5, a proposal the reviewer can change)
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { tracks, users } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext, type AdminPermission } from '@/lib/identity/server';
import { confirmMasterUpload, confirmRightsDocument, createTrack, listTaxonomy, processVersion, requestMasterUpload, requestRightsDocumentUpload, saveRightsDeclaration, submitTrack } from '@/lib/catalog/server';
import { hasOrgAccepted } from '@/lib/legal/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { BUCKETS } from '@/lib/platform/storage';
import { getSupabaseAdmin } from '@/lib/platform/supabase';
import { getSellerStanding } from '@/lib/sellers/server';
import { csvRecords, toImportRow, type ImportRow } from './import-catalog-rows';

type Outcome = { line: number; title: string; result: 'imported' | 'would import' | 'skipped' | 'failed'; note?: string };

const { values: args } = parseArgs({
  options: {
    csv: { type: 'string' },
    files: { type: 'string' },
    org: { type: 'string' },
    user: { type: 'string' },
    admin: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'confirm-warranties': { type: 'boolean', default: false },
  },
});

const fail: (msg: string) => never = (msg) => {
  throw new Error(msg);
};

/** A file named in the CSV, which must sit inside the files folder (no `..`, no absolute paths). */
function inside(root: string, name: string): string | null {
  const full = resolve(root, name);
  const rel = relative(root, full);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) && existsSync(full) ? full : null;
}

async function upload(bucket: string, key: string, token: string, file: string, contentType: string) {
  const { error } = await getSupabaseAdmin().storage.from(bucket).uploadToSignedUrl(key, token, readFileSync(file), { contentType });
  if (error) throw new Error(`upload failed: ${error.message}`);
}

async function importRow(actor: { userId: string; orgId: string }, row: ImportRow, root: string): Promise<string> {
  const db = getDb();
  const trackId = await createTrack(db, actor, row.input);
  await saveRightsDeclaration(db, actor, trackId, { masterControlled: true, compositionControlled: true, coOwnerConsentWarranted: true, sampleFreeWarranted: true, notACoverWarranted: true });

  const masterExt = row.masterFile.slice(row.masterFile.lastIndexOf('.') + 1);
  const m = await requestMasterUpload(db, actor, trackId, masterExt);
  await upload(BUCKETS.masters, m.key, m.token, inside(root, row.masterFile)!, masterExt.toLowerCase() === 'wav' ? 'audio/wav' : 'audio/mpeg');
  const versionId = await confirmMasterUpload(db, actor, trackId, m.versionId, masterExt);

  const d = await requestRightsDocumentUpload(db, actor, trackId, { docType: row.rightsDocType, mime: row.rightsMime });
  await upload(BUCKETS.documents, d.key, d.token, inside(root, row.rightsDocument)!, row.rightsMime);
  const doc = await confirmRightsDocument(db, actor, d.documentId);
  if (doc.status !== 'valid') fail(`rights document rejected: ${doc.error ?? doc.status}`);

  await processVersion(versionId); // ingest: submit needs the audio processed (screening runs too)
  const submitted = await submitTrack(db, actor, trackId);
  if (!submitted.ok) fail(submitted.issues.join('; '));
  return trackId; // the track is `submitted`; the cron sweep moves it to review once screening is done
}

/** The operator, as the admin the rest of the app would see: an admin user with `verification` (or superadmin). */
async function loadAdmin(userId: string): Promise<AdminContext> {
  const [u] = await getDb().select({ role: users.platformRole, perms: users.adminPermissions }).from(users).where(eq(users.id, userId));
  if (u?.role !== 'admin') fail('--admin must be an admin user');
  const admin: AdminContext = { userId, permissions: (u?.perms ?? []) as AdminPermission[] };
  requirePermission(admin, 'verification');
  return admin;
}

async function main() {
  const { csv, files, org, user, admin: adminId } = args;
  if (!csv || !files || !org || !user || !adminId) fail('usage: --csv <file> --files <folder> --org <org id> --user <member id> --admin <admin id> [--dry-run] [--confirm-warranties]');
  const dryRun = args['dry-run'];
  if (!dryRun && !args['confirm-warranties']) fail('Importing declares, for every track, that the label controls the master and composition, has co-owner consent, and the track has no uncleared samples and is not a cover. Re-run with --confirm-warranties once the label has agreed that in its contract, or use --dry-run.');
  const admin = await loadAdmin(adminId);
  const actor = { userId: user, orgId: org };
  const root = resolve(files);
  const db = getDb();

  const standing = await getSellerStanding(db, actor.orgId);
  if (!standing) fail('This organisation has not completed seller onboarding');
  if (standing && standing.status !== 'active') fail(`The seller account is ${standing.status}`);
  if (standing && standing.kycStatus === 'rejected') fail('Seller verification was rejected');
  if (!(await hasOrgAccepted(db, actor.orgId, 'seller_agreement'))) fail('The organisation has not accepted the seller agreement');

  const taxonomy = await listTaxonomy(db);
  const records = csvRecords(readFileSync(resolve(csv), 'utf8'));
  if (records.length === 0) fail('The CSV has no rows');

  const have = new Set(
    (await db.select({ title: tracks.title, artist: tracks.primaryArtist }).from(tracks).where(eq(tracks.sellerOrgId, actor.orgId))).map((t) => `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`),
  );
  const outcomes: Outcome[] = [];
  for (const rec of records) {
    const title = rec.fields.title || '(no title)';
    const parsed = toImportRow(rec.fields, taxonomy);
    const problems = parsed.ok ? [] : [...parsed.errors];
    if (parsed.ok) {
      if (!inside(root, parsed.row.masterFile)) problems.push(`master_file: "${parsed.row.masterFile}" not found in the files folder`);
      if (!inside(root, parsed.row.rightsDocument)) problems.push(`rights_document: "${parsed.row.rightsDocument}" not found in the files folder`);
    }
    if (problems.length || !parsed.ok) {
      outcomes.push({ line: rec.line, title, result: 'failed', note: problems.join('; ') });
      continue;
    }
    const key = `${parsed.row.input.title.toLowerCase()}|${parsed.row.input.primaryArtist.toLowerCase()}`;
    if (have.has(key)) {
      outcomes.push({ line: rec.line, title, result: 'skipped', note: 'the organisation already has this title by this artist' });
      continue;
    }
    if (dryRun) {
      outcomes.push({ line: rec.line, title, result: 'would import' });
      have.add(key); // a repeated row inside the file is flagged too
      continue;
    }
    try {
      const trackId = await importRow(actor, parsed.row, root);
      have.add(key);
      await writeAudit(db, { actorUserId: admin.userId, action: 'catalog.import', entityType: 'track', entityId: trackId, after: { orgId: actor.orgId, asMember: actor.userId, csvLine: rec.line, warrantiesDeclaredForSeller: true } });
      outcomes.push({ line: rec.line, title, result: 'imported' });
    } catch (e) {
      // A draft may be left behind: the label can finish or delete it from its dashboard, and a re-run skips it (same title and artist).
      outcomes.push({ line: rec.line, title, result: 'failed', note: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!dryRun) {
    const n = (r: Outcome['result']) => outcomes.filter((o) => o.result === r).length;
    await writeAudit(db, { actorUserId: admin.userId, action: 'catalog.import_run', entityType: 'seller_org', entityId: actor.orgId, after: { csv: basename(csv), imported: n('imported'), skipped: n('skipped'), failed: n('failed') } });
  }
  console.log(`${dryRun ? 'DRY RUN, nothing written. ' : ''}Import report for organisation ${actor.orgId}`);
  for (const o of outcomes) console.log(`  line ${o.line}: ${o.result.padEnd(12)} ${o.title}${o.note ? `  (${o.note})` : ''}`);
  const count = (r: Outcome['result']) => outcomes.filter((o) => o.result === r).length;
  console.log(`${count('imported') + count('would import')} ${dryRun ? 'would be imported' : 'imported'}, ${count('skipped')} skipped, ${count('failed')} failed`);
  if (count('failed')) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
