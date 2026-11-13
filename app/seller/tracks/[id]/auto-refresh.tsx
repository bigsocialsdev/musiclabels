'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the page every few seconds while the audio is still being processed, so the status badge catches up. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
