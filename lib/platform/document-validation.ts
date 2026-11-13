export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

export type DocumentValidation = { ok: true; mime: DocumentMime } | { ok: false; error: string };

const MAX_DIMENSION = 20_000;

/** Content sniffing by magic bytes; never trust the declared type or the file name (PLAN F9). */
export function sniffMime(b: Uint8Array): DocumentMime | null {
  const startsWith = (sig: number[]) => sig.every((v, i) => b[i] === v);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

function pngDimensions(b: Uint8Array): [number, number] | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (b.length < 24 || String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [dv.getUint32(16), dv.getUint32(20)];
}

function jpegDimensions(b: Uint8Array): [number, number] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return [dv.getUint16(i + 7), dv.getUint16(i + 5)];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) i += 2;
    else i += 2 + dv.getUint16(i + 2);
  }
  return null;
}

// Active content that a rights document never needs. Heuristic: object streams can hide these.
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/;

function validatePdf(b: Uint8Array): string | null {
  const text = Buffer.from(b).toString('latin1');
  if (!text.slice(-1024).includes('%%EOF')) return 'PDF is truncated or malformed';
  if (PDF_ACTIVE_CONTENT.test(text)) return 'PDF contains active content (scripts, launch actions or embedded files)';
  return null;
}

/**
 * Validates a rights/KYC document before an admin may open it: size cap, content matches the
 * declared type, image dimensions sane, no active content in PDFs. Admins also only ever get it as an attachment download.
 */
export function validateRightsDocument(bytes: Uint8Array, declaredMime: string): DocumentValidation {
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(declaredMime)) return { ok: false, error: 'Only PDF, JPG or PNG files are accepted' };
  if (bytes.length === 0 || bytes.length < 64) return { ok: false, error: 'File is empty or too small' };
  if (bytes.length > MAX_DOCUMENT_BYTES) return { ok: false, error: 'File is larger than 10 MB' };

  const actual = sniffMime(bytes);
  if (!actual) return { ok: false, error: 'File content is not a PDF, JPG or PNG' };
  if (actual !== declaredMime) return { ok: false, error: 'File content does not match its declared type' };

  if (actual === 'application/pdf') {
    const problem = validatePdf(bytes);
    return problem ? { ok: false, error: problem } : { ok: true, mime: actual };
  }
  const dims = actual === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!dims) return { ok: false, error: 'Image is malformed' };
  const [w, h] = dims;
  if (w < 1 || h < 1 || w > MAX_DIMENSION || h > MAX_DIMENSION) return { ok: false, error: 'Image dimensions are out of range' };
  return { ok: true, mime: actual };
}
