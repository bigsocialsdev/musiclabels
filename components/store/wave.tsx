'use client';
import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

/** m:ss for a time in seconds. */
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Idle strip shown until the real peaks arrive: a flat, quiet line the same width as the final waveform. */
const FLAT = Array.from({ length: 60 }, () => 0.16);

/**
 * The track's own waveform (DESIGN.md signature): idle bars, tape-orange played bars, the last played bar as the head.
 * `progress` is 0..1. With `onSeek` it is a click target; with `slider` it is also a keyboard slider (Left/Right 5 s).
 */
export const Wave = memo(function Wave({
  peaks,
  progress = 0,
  onSeek,
  slider,
  className,
}: {
  peaks: number[] | null | undefined;
  progress?: number;
  onSeek?: (fraction: number) => void;
  slider?: { label: string; valueNow: number; valueMax: number; onStep: (deltaSeconds: number) => void };
  className?: string;
}) {
  const bars = peaks && peaks.length ? peaks : FLAT;
  const on = Math.floor(Math.min(1, Math.max(0, progress)) * bars.length);
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!slider) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      slider.onStep(e.key === 'ArrowRight' ? 5 : -5);
    }
  };
  return (
    <div
      className={cn('wave flex min-w-0 items-center gap-[3px] overflow-hidden', onSeek && 'cursor-pointer', className)}
      onClick={click}
      {...(slider
        ? { role: 'slider', tabIndex: 0, 'aria-label': slider.label, 'aria-valuemin': 0, 'aria-valuemax': Math.round(slider.valueMax), 'aria-valuenow': Math.round(slider.valueNow), 'aria-valuetext': fmt(slider.valueNow), onKeyDown: key }
        : { 'aria-hidden': true })}
    >
      {bars.map((h, i) => (
        <i
          key={i}
          className={cn('wave-bar min-w-px flex-1 rounded-[1px] bg-wave-idle transition-colors duration-200', i < on && 'is-on bg-wave-played', i === on - 1 && 'is-head')}
          style={{ height: `${Math.max(10, Math.round(h * 100))}%` }}
        />
      ))}
    </div>
  );
});
