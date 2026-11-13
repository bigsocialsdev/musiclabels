'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { selectClass } from './ui';
import { createSupabaseBrowserClient } from '@/lib/platform/supabase-browser';

type Requested = { ok: true; id: string; key: string; token: string } | { ok: false; error: string };
type Confirmed = { ok: true; message: string } | { ok: false; error: string };

/**
 * Browser upload straight to private storage with a signed URL, in three steps: the server allocates a row and a
 * URL (`request`), the browser uploads, then the server checks what arrived (`confirm`). The server actions
 * decide everything; this component only moves the bytes.
 */
export function UploadForm({
  bucket,
  accept,
  fileLabel,
  choice,
  request,
  confirm,
}: {
  bucket: 'masters' | 'documents';
  accept: string;
  fileLabel: string;
  /** An optional select sent along with the request (document kind or type). */
  choice?: { label: string; options: readonly (readonly [string, string])[] };
  request: (input: { choice: string; filename: string; mime: string }) => Promise<Requested>;
  confirm: (id: string) => Promise<Confirmed>;
}) {
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const picked = String(new FormData(form).get('choice') ?? '');
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return setMessage({ ok: false, text: 'Choose a file.' });
    setBusy(true);
    setMessage(null);
    try {
      const req = await request({ choice: picked, filename: file.name, mime: file.type });
      if (!req.ok) return setMessage({ ok: false, text: req.error });
      const up = await createSupabaseBrowserClient().storage.from(bucket).uploadToSignedUrl(req.key, req.token, file);
      if (up.error) return setMessage({ ok: false, text: 'The upload failed. Please try again.' });
      const checked = await confirm(req.id);
      setMessage(checked.ok ? { ok: true, text: checked.message } : { ok: false, text: checked.error });
      form.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {choice && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-choice`}>{choice.label}</Label>
          <select id={`${uid}-choice`} name="choice" className={selectClass}>
            {choice.options.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-file`}>{fileLabel}</Label>
        <input id={`${uid}-file`} name="file" type="file" accept={accept} required className="text-sm" />
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
