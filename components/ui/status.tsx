import { cn } from '@/lib/utils';

export type StatusTone = 'ok' | 'attention' | 'blocked' | 'info' | 'muted';

const DOT: Record<StatusTone, string> = {
  ok: 'bg-ok',
  attention: 'bg-attention',
  blocked: 'bg-blocked',
  info: 'bg-info',
  muted: 'bg-fg-4',
};

/** Status as a 7px dot plus a word (DESIGN.md: never a filled badge or banner). */
export function StatusLabel({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-foreground', className)}>
      <span aria-hidden className={cn('size-[7px] shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}
