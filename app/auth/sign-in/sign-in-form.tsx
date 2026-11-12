'use client';

import { useState, useTransition } from 'react';
import { createSupabaseBrowserClient } from '@/lib/platform/supabase-browser';
import { finishSignIn } from '../actions';

type Method = 'email' | 'phone';

export function SignInForm({ next }: { next?: string }) {
  const supabase = createSupabaseBrowserClient();
  const [method, setMethod] = useState<Method>('email');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const { error } = await supabase.auth.signInWithOtp(method === 'email' ? { email: target } : { phone: target });
      if (error) setError(error.message);
      else setSent(true);
    });

  const verify = () =>
    start(async () => {
      setError(null);
      const { error } =
        method === 'email'
          ? await supabase.auth.verifyOtp({ email: target, token: code, type: 'email' })
          : await supabase.auth.verifyOtp({ phone: target, token: code, type: 'sms' });
      if (error) return setError(error.message);
      await finishSignIn(next);
    });

  const google = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next ?? '/')}` },
    });

  return (
    <div className="mt-4 space-y-3">
      <div className="flex gap-2">
        {(['email', 'phone'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            className="rounded border px-3 py-1 aria-pressed:bg-neutral-200 dark:aria-pressed:bg-neutral-700"
            onClick={() => {
              setMethod(m);
              setSent(false);
              setTarget('');
            }}
          >
            {m === 'email' ? 'Email' : 'Phone (+91)'}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-sm">{method === 'email' ? 'Email address' : 'Mobile number, e.g. +919876543210'}</span>
        <input
          className="mt-1 w-full rounded border p-2"
          type={method === 'email' ? 'email' : 'tel'}
          autoComplete={method === 'email' ? 'email' : 'tel'}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={sent}
        />
      </label>
      {sent ? (
        <>
          <label className="block">
            <span className="text-sm">6-digit code</span>
            <input
              className="mt-1 w-full rounded border p-2"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button type="button" className="w-full rounded bg-black p-2 text-white" disabled={pending || !code} onClick={verify}>
            Verify and sign in
          </button>
        </>
      ) : (
        <button type="button" className="w-full rounded bg-black p-2 text-white" disabled={pending || !target} onClick={send}>
          Send code
        </button>
      )}
      <button type="button" className="w-full rounded border p-2" onClick={google}>
        Continue with Google
      </button>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
