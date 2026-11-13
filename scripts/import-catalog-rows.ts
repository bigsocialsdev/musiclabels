/** Pure parts of the concierge catalog import (CSV parsing and row validation), kept apart from the I/O so they can be tested. */
import { trackInputSchema, DOC_TYPES, type DocType, type TrackInput } from '@/lib/catalog';

/** RFC 4180 subset: comma separated, `"` quoting with `""` escapes, quoted newlines, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export type RawRow = { line: number; fields: Record<string, string> };

/** First row is the header. `line` is the 1-based record number in the file, for the report. */
export function csvRecords(text: string): RawRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  return body.map((cells, i) => ({ line: i + 2, fields: Object.fromEntries(names.map((n, c) => [n, (cells[c] ?? '').trim()])) }));
}

export type Taxonomy = { genres: { id: string; name: string }[]; moods: { id: string; name: string }[] };

export type ImportRow = { input: TrackInput; masterFile: string; rightsDocument: string; rightsDocType: DocType; rightsMime: string };

const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const list = (v: string | undefined) => (v ?? '').split(';').map((s) => s.trim()).filter(Boolean);
const extOf = (file: string) => file.slice(file.lastIndexOf('.') + 1).toLowerCase();

function bool(v: string | undefined, errors: string[], column: string): boolean | undefined {
  if (!v) return undefined;
  const t = v.toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(t)) return true;
  if (['no', 'false', '0', 'n'].includes(t)) return false;
  errors.push(`${column}: use yes or no`);
  return undefined;
}

/** Validates one CSV record with the same schema the seller form uses. Returns every problem at once. */
export function toImportRow(fields: Record<string, string>, taxonomy: Taxonomy): { ok: true; row: ImportRow } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const pick = (list_: { id: string; name: string }[], name: string, column: string) => {
    const hit = list_.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!hit) errors.push(`${column}: "${name}" is not in the ${column} list`);
    return hit?.id;
  };
  const genreName = fields.genre;
  const genreId = genreName ? (pick(taxonomy.genres, genreName, 'genre') ?? null) : null;
  const moodIds = list(fields.moods).map((m) => pick(taxonomy.moods, m, 'mood'));
  const bpmText = fields.bpm;
  const bpm = bpmText ? Number(bpmText) : null;
  const flags = {
    explicit: bool(fields.explicit, errors, 'explicit'),
    aiGeneratedDeclared: bool(fields.ai_generated, errors, 'ai_generated'),
    organicSocial: bool(fields.organic_social, errors, 'organic_social'),
    paidAds: bool(fields.paid_ads, errors, 'paid_ads'),
    editsAllowed: bool(fields.edits_allowed, errors, 'edits_allowed'),
  };
  const parsed = trackInputSchema.safeParse({
    title: fields.title,
    primaryArtist: fields.primary_artist,
    featuredArtists: list(fields.featured_artists),
    composers: list(fields.composers),
    lyricists: list(fields.lyricists),
    genreId,
    moodIds: moodIds.filter((x): x is string => Boolean(x)),
    language: fields.language?.toLowerCase(),
    bpm: bpm !== null && Number.isFinite(bpm) ? bpm : bpmText ? 'x' : null,
    proposedPriceLevel: fields.price_level ? fields.price_level.toUpperCase() : null,
    ...Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined)),
  });
  if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${String(i.path[0] ?? 'row')}: ${i.message}`);

  const masterFile = fields.master_file ?? '';
  if (!['wav', 'mp3'].includes(extOf(masterFile))) errors.push('master_file: give a .wav or .mp3 file name');
  const rightsDocument = fields.rights_document ?? '';
  const rightsMime = MIME_BY_EXT[extOf(rightsDocument)];
  if (!rightsMime) errors.push('rights_document: give a .pdf, .jpg or .png file name');
  const docType = (fields.rights_doc_type || 'distribution_agreement') as DocType;
  if (!DOC_TYPES.includes(docType)) errors.push(`rights_doc_type: one of ${DOC_TYPES.join(', ')}`);

  if (errors.length || !parsed.success || !rightsMime) return { ok: false, errors };
  return { ok: true, row: { input: parsed.data, masterFile, rightsDocument, rightsDocType: docType, rightsMime } };
}
