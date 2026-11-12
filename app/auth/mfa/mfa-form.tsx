'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/platform/supabase-browser';

/** Enrols a TOTP factor on first use, otherwise challenges the existing one. Success upgrades the session to AAL2. */
export function MfaForm({ next }: { next: string }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === 'verified');
      if (verified) return setFactorId(verified.id);
      // Drop abandoned, never-verified factors so enrolment can be retried.
      for (const f of data?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrolled.error) return setError(enrolled.error.message);
      setFactorId(enrolled.data.id);
      setQr(enrolled.data.totp.qr_code);
    })();
  }, [supabase]);

  const verify = () =>
    start(async () => {
      if (!factorId) return;
      setError(null);
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) return setError(error.message);
      router.push(next);
      router.refresh();
    });

  return (
    <div className="mt-4 space-y-3">
      {qr && (
        <>
          <p className="text-sm">Scan this QR code with an authenticator app, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="TOTP setup QR code" className="h-48 w-48" />
        </>
      )}
      <label className="block">
        <span className="text-sm">Authenticator code</span>
        <input
          className="mt-1 w-full rounded border p-2"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <button type="button" className="w-full rounded bg-black p-2 text-white" disabled={pending || !factorId || !code} onClick={verify}>
        Verify
      </button>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
