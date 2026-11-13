import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, sniffMime, validateRightsDocument } from './document-validation';

const pad = (head: number[] | string, total = 200) => {
  const h = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head);
  return Buffer.concat([h, Buffer.alloc(Math.max(0, total - h.length), 0x20)]);
};

const pdf = (body = '') => Buffer.from(`%PDF-1.4\n${body}\n1 0 obj << /Type /Catalog >> endobj\n${' '.repeat(80)}\n%%EOF\n`, 'latin1');

function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function jpeg(w: number, h: number) {
  // SOI, APP0 (len 16), SOF0 (len 17: precision, height, width, ...), padding
  const b = Buffer.alloc(80, 0);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(b, 0);
  const sof = 20;
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(b, sof);
  b.writeUInt16BE(h, sof + 5);
  b.writeUInt16BE(w, sof + 7);
  return b;
}

describe('validateRightsDocument', () => {
  it('accepts a well-formed PDF, PNG and JPEG', () => {
    expect(validateRightsDocument(pdf(), 'application/pdf')).toEqual({ ok: true, mime: 'application/pdf' });
    expect(validateRightsDocument(png(800, 600), 'image/png')).toEqual({ ok: true, mime: 'image/png' });
    expect(validateRightsDocument(jpeg(800, 600), 'image/jpeg')).toEqual({ ok: true, mime: 'image/jpeg' });
  });

  it('rejects a renamed executable posing as a PDF (MZ header)', () => {
    const exe = pad('MZ\x90\x00\x03\x00\x00\x00 This program cannot be run in DOS mode.');
    const r = validateRightsDocument(exe, 'application/pdf');
    expect(r.ok).toBe(false);
    expect(sniffMime(exe)).toBeNull();
  });

  it('rejects a PNG declared as a PDF and vice versa', () => {
    expect(validateRightsDocument(png(10, 10), 'application/pdf')).toMatchObject({ ok: false });
    expect(validateRightsDocument(pdf(), 'image/png')).toMatchObject({ ok: false });
  });

  it('rejects unsupported declared types, empty and oversized files', () => {
    expect(validateRightsDocument(pdf(), 'application/zip')).toMatchObject({ ok: false });
    expect(validateRightsDocument(Buffer.alloc(0), 'application/pdf')).toMatchObject({ ok: false });
    expect(validateRightsDocument(Buffer.concat([pdf(), Buffer.alloc(MAX_DOCUMENT_BYTES)]), 'application/pdf')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/10 MB/),
    });
  });

  it('rejects PDFs with scripts, launch actions or embedded files, and truncated PDFs', () => {
    expect(validateRightsDocument(pdf('/S /JavaScript /JS (app.alert(1))'), 'application/pdf')).toMatchObject({ ok: false });
    expect(validateRightsDocument(pdf('/Launch /Win'), 'application/pdf')).toMatchObject({ ok: false });
    expect(validateRightsDocument(pdf('/EmbeddedFile'), 'application/pdf')).toMatchObject({ ok: false });
    expect(validateRightsDocument(pad('%PDF-1.4 no end marker here'), 'application/pdf')).toMatchObject({ ok: false });
  });

  it('rejects images with absurd or zero dimensions', () => {
    expect(validateRightsDocument(png(0, 10), 'image/png')).toMatchObject({ ok: false });
    expect(validateRightsDocument(png(50_000, 10), 'image/png')).toMatchObject({ ok: false });
    expect(validateRightsDocument(jpeg(30_000, 10), 'image/jpeg')).toMatchObject({ ok: false });
  });
});
