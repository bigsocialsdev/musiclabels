'use client';
import { useState } from 'react';
import { docActionClass } from './doc-row';

/** Copies a short value (a verification code) to the clipboard; says "Copied" for two seconds. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={docActionClass}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
