'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Tempo filter: two knobs on one track. The URL changes when a knob is let go (or a key is released), not on every
 * step, so dragging does not reload results.
 */
export function BpmRange({ bounds, value, baseHref }: { bounds: { min: number; max: number }; value: { min?: number; max?: number }; baseHref: string }) {
  const router = useRouter();
  const [lo, setLo] = useState(value.min ?? bounds.min);
  const [hi, setHi] = useState(value.max ?? bounds.max);
  const span = Math.max(1, bounds.max - bounds.min);
  const pct = (n: number) => ((n - bounds.min) / span) * 100;

  const commit = () => {
    const sep = baseHref.includes('?') ? '&' : '?';
    const parts = [lo > bounds.min ? `bpmMin=${lo}` : '', hi < bounds.max ? `bpmMax=${hi}` : ''].filter(Boolean);
    router.push(parts.length ? `${baseHref}${sep}${parts.join('&')}` : baseHref);
  };

  if (bounds.min === bounds.max) return <p className="px-2.5 text-[13px] text-muted-foreground">All tracks are {bounds.min} BPM.</p>;
  return (
    <div className="px-2.5 pt-1">
      <div className="dual-range relative my-3.5 h-4">
        <div aria-hidden className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-sm bg-surface-3" />
        <div aria-hidden className="absolute top-1/2 h-1 -translate-y-1/2 rounded-sm bg-foreground" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        <input
          type="range"
          aria-label="Slowest tempo, beats per minute"
          min={bounds.min}
          max={bounds.max}
          value={lo}
          onChange={(e) => setLo(Math.min(Number(e.target.value), hi))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
        <input
          type="range"
          aria-label="Fastest tempo, beats per minute"
          min={bounds.min}
          max={bounds.max}
          value={hi}
          onChange={(e) => setHi(Math.max(Number(e.target.value), lo))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </div>
      <div className="flex justify-between font-mono text-xs font-normal text-muted-foreground">
        <span>{lo} BPM</span>
        <span>{hi} BPM</span>
      </div>
    </div>
  );
}
