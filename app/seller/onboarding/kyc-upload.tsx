'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/lib/platform/supabase-browser';
import { confirmKycDocumentAction, requestKycUploadAction } from './actions';

const KINDS = [
  ['pan_card', 'PAN card'],
  ['id_proof', 'ID proof'],
  ['gst_certificate', 'GST certificate'],
  ['bank_proof', 'Bank proof (cancelled cheque or statement)'],
] as const;

/** Browser upload straight to private storage with a signed URL; the server then checks the file's content. */
export function KycUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const kind = String(new FormData(form).get('kind'));
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return setMessage({ ok: false, text: 'Choose a file.' });
    setBusy(true);
    setMessage(null);
    try {
      const req = await requestKycUploadAction({ kind, mime: file.type });
      if (!req.ok) return setMessage({ ok: false, text: req.error });
      const up = await createSupabaseBrowserClient().storage.from('documents').uploadToSignedUrl(req.key, req.token, file);
      if (up.error) return setMessage({ ok: false, text: 'The upload failed. Please try again.' });
      const checked = await confirmKycDocumentAction(req.documentId);
      if (!checked.ok) return setMessage({ ok: false, text: checked.error });
      setMessage(checked.status === 'valid' ? { ok: true, text: 'Uploaded and checked.' } : { ok: false, text: checked.error ?? 'The file was rejected.' });
      form.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-1.5">
        <Label htmlFor="kind">Document</Label>
        <select id="kind" name="kind" className="h-9 rounded-md border bg-transparent px-3 text-sm">
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="file">File (PDF, JPG or PNG, up to 10 MB)</Label>
        <input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-green-700' : 'text-sm text-red-700'}>
          {message.text}
        </p>
      )}
    </form>
  );
}
