'use client';
import Link from 'next/link';
import { useState } from 'react';
import { SELL_HREF } from './account-links';

/**
 * First-visit band above the browse grid (owner decision 2026-11-14). Deliberately smaller than the stage below it: no
 * glow, no card, headline size, not display. Dismissal is remembered in a cookie so the server never renders it again.
 */
export function IntroBand({ cookie }: { cookie: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const dismiss = () => {
    document.cookie = `${cookie}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
  };
  return (
    <section aria-labelledby="intro-title" className="mx-auto max-w-[1440px] px-6 pt-6 max-[900px]:px-4 max-[900px]:pt-4">
      <div className="flex items-start justify-between gap-6 border-b pb-6 max-[900px]:pb-4">
        <div className="max-w-[720px]">
          <h2 id="intro-title" className="text-headline max-[900px]:text-xl">
            Music for your videos, licensed properly.
          </h2>
          <p className="mt-1.5 text-[15px] text-fg-2 max-[900px]:text-sm">
            Press play on any track below. Every track is screened before it is listed, and every license comes with a certificate, a public verify link and a GST invoice.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Make music?{' '}
            <Link href={SELL_HREF} className="font-semibold text-foreground underline-offset-4 hover:underline">
              Sell your music
            </Link>
          </p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss introduction" className="-mt-1 grid size-9 flex-none place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
          <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </section>
  );
}
