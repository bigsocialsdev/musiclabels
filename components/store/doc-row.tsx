import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const Glyph = () => (
  <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-2">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

/** A document or file row (DESIGN.md Document Row): glyph, name with an optional muted line, and one action on the right. */
export function DocRow({ name, note, meta, action, className }: { name: ReactNode; note?: ReactNode; meta?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <li className={cn('flex min-w-0 items-center gap-3 rounded-md border bg-card px-3.5 py-2.5', className)}>
      <Glyph />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {note && <p className="text-[13px] text-muted-foreground">{note}</p>}
      </div>
      {meta && <span className="font-mono text-[13px] font-normal text-fg-2">{meta}</span>}
      {action}
    </li>
  );
}

/** The text action at the end of a DocRow (a link or, wrapped in a form, a button). */
export const docActionClass = 'rounded-sm px-2.5 py-1.5 text-[13px] font-semibold text-foreground underline-offset-4 hover:underline disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline';
