/**
 * Concierge catalog import (PLAN §5.1): a label's CSV of metadata plus a local folder of masters and rights
 * documents become tracks under the label's seller organisation, submitted for the normal pipeline
 * (ingest, screening, claim probe, admin review). Nothing is published by this script.
 *
 *   npm run import:catalog -- --csv tracks.csv --files ./masters --org <seller org id> --user <member user id> --dry-run
 *   npm run import:catalog -- --csv tracks.csv --files ./masters --org <seller org id> --user <member user id> --confirm-warranties
 *
 * `--user` is a signed-up member of the label's organisation; the import acts as them, so every seller-side
 * guard applies (onboarding done, seller agreement accepted, KYC not rejected). Re-running skips tracks the
 * organisation already has with the same title and primary artist. `--dry-run` checks everything it can
 * without writing or uploading. Needs DATABASE_URL, the Supabase URL and service-role key, and ffmpeg (ingest).
 *
 * CSV columns (header row, `;` separates list values, yes/no for flags):
 *   title, primary_artist, language (hindi|punjabi|tamil|english|instrumental), master_file, rights_document  (required)
 *   rights_doc_type, featured_artists, composers, lyricists, genre, moods, bpm, explicit, ai_generated,
 *   organic_social, paid_ads, edits_allowed, price_level (L1..L5, a proposal the reviewer can change)
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { tracks } from '@/db/schema';
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

async function importRow(actor: { userId: string; orgId: string }, row: ImportRow, root: string): Promise<void> {
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

  await processVersion(versionId); // ingest: submit needs the audio processed
  const submitted = await submitTrack(db, actor, trackId);
  if (!submitted.ok) fail(submitted.issues.join('; '));
  await processVersion(versionId); // screening, then the track moves to the review queue
}

async function main() {
  const { csv, files, org, user } = args;
  if (!csv || !files || !org || !user) fail('usage: --csv <file> --files <folder> --org <org id> --user <member id> [--dry-run] [--confirm-warranties]');
  const dryRun = args['dry-run'];
  if (!dryRun && !args['confirm-warranties']) fail('Importing declares, for every track, that the label controls the master and composition, has co-owner consent, and the track has no uncleared samples and is not a cover. Re-run with --confirm-warranties once the label has agreed that in its contract, or use --dry-run.');
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
      await importRow(actor, parsed.row, root);
      have.add(key);
      outcomes.push({ line: rec.line, title, result: 'imported' });
    } catch (e) {
      // A draft may be left behind: the label can finish or delete it from its dashboard, and a re-run skips it (same title and artist).
      outcomes.push({ line: rec.line, title, result: 'failed', note: e instanceof Error ? e.message : String(e) });
    }
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
