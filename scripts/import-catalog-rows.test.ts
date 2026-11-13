import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv, toImportRow } from './import-catalog-rows';

const taxonomy = { genres: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Indie pop' }], moods: [{ id: '00000000-0000-4000-8000-000000000002', name: 'Chill' }] };
const good = { title: 'Raat', primary_artist: 'A', language: 'Hindi', master_file: 'raat.wav', rights_document: 'raat.pdf' };

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });

  it('keys records by lower-cased header and numbers them from the header line', () => {
    expect(csvRecords('Title, Primary_Artist\nRaat,A\n')).toEqual([{ line: 2, fields: { title: 'Raat', primary_artist: 'A' } }]);
  });
});

describe('toImportRow', () => {
  it('maps a minimal row with defaults and resolves taxonomy names case-insensitively', () => {
    const r = toImportRow({ ...good, genre: 'indie POP', moods: 'chill', composers: 'X; Y', bpm: '120', paid_ads: 'yes', price_level: 'l2' }, taxonomy);
    expect(r).toMatchObject({ ok: true, row: { masterFile: 'raat.wav', rightsDocType: 'distribution_agreement', rightsMime: 'application/pdf' } });
    if (r.ok) expect(r.row.input).toMatchObject({ language: 'hindi', genreId: taxonomy.genres[0]!.id, moodIds: [taxonomy.moods[0]!.id], composers: ['X', 'Y'], bpm: 120, paidAds: true, proposedPriceLevel: 'L2' });
  });

  it('reports every problem in one pass', () => {
    const r = toImportRow({ title: '', primary_artist: 'A', language: 'klingon', genre: 'Polka', explicit: 'maybe', bpm: 'fast', master_file: 'x.flac', rights_document: 'y.docx', rights_doc_type: 'nope' }, taxonomy);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.errors.join('\n');
      for (const needle of ['genre', 'explicit', 'bpm', 'title', 'language', 'master_file', 'rights_document', 'rights_doc_type']) expect(text).toContain(needle);
    }
  });
});
