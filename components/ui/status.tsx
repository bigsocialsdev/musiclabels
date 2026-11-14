import { cn } from '@/lib/utils';

export type StatusTone = 'ok' | 'attention' | 'blocked' | 'info' | 'muted';

const DOT: Record<StatusTone, string> = {
  ok: 'bg-ok',
  attention: 'bg-attention',
  blocked: 'bg-blocked',
  info: 'bg-info',
  muted: 'bg-fg-4',
};

/** Daylight (seller, admin) tints the pill; the dark storefront drops the fill and keeps dot plus word (DESIGN.md). */
export const TONE_FILL: Record<StatusTone, string> = {
  ok: 'bg-ok-soft text-ok',
  attention: 'bg-attention-soft text-attention',
  blocked: 'bg-blocked-soft text-blocked',
  info: 'bg-info-soft text-info',
  muted: 'bg-muted-soft text-muted-foreground',
};

/** Status as a tinted pill with a 7px dot (daylight), or dot plus word on the night surface. */
export function StatusLabel({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] font-semibold whitespace-nowrap',
        TONE_FILL[tone],
        'dark:px-0 dark:py-0 dark:text-[13px] dark:text-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

export const TONE_DOT = DOT;
