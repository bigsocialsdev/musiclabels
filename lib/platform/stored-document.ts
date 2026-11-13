import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUCKETS, type ObjectStore } from './storage';
import { DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES, validateRightsDocument, type DocumentMime } from './document-validation';

export const DOC_EXTENSIONS: Record<DocumentMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export { DOCUMENT_MIME_TYPES };

/**
 * Downloads an uploaded rights or KYC document from the documents bucket and applies the F9 checks (size, magic bytes
 * vs the declared type, PDF active content, image dimensions). Never throws for a bad or missing file: it reports it.
 */
export async function validateStoredDocument(store: ObjectStore, fileKey: string, declaredMime: string): Promise<{ status: 'valid' | 'rejected'; error: string | null; size: number | null }> {
  const work = await mkdtemp(path.join(tmpdir(), 'mrm-doc-'));
  try {
    const file = path.join(work, 'doc');
    try {
      await store.downloadToFile(BUCKETS.documents, fileKey, file);
      const size = (await stat(file)).size;
      if (size > MAX_DOCUMENT_BYTES) return { status: 'rejected', error: 'The file is larger than 10 MB', size };
      const result = validateRightsDocument(await readFile(file), declaredMime);
      return result.ok ? { status: 'valid', error: null, size } : { status: 'rejected', error: result.error, size };
    } catch {
      return { status: 'rejected', error: 'The uploaded file was not found. Please upload it again.', size: null };
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
