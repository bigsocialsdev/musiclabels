import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StatusTone } from '@/components/ui/status';
import { cn } from '@/lib/utils';

/** Shared by the seller forms. */
export const selectClass = 'h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring';

/** Page frame: one width per page kind (forms read narrow, tables need room). */
export function Page({ width = 'form', children }: { width?: 'form' | 'wide'; children: ReactNode }) {
  return <main className={cn('mx-auto space-y-5 px-5 pt-6 pb-16', width === 'form' ? 'max-w-2xl' : 'max-w-5xl')}>{children}</main>;
}

export function PageHeader({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-3 text-headline">{title}</h1>
        {aside}
      </div>
      {children && <p className="max-w-[70ch] text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

const NOTICE_DOT: Record<StatusTone, string> = { ok: 'bg-ok', attention: 'bg-attention', blocked: 'bg-blocked', info: 'bg-info', muted: 'bg-fg-4' };

/** A message row: dot plus text on the card surface, never a filled colour band. */
export function Notice({ tone, role, children }: { tone: StatusTone; role?: 'alert' | 'status'; children: ReactNode }) {
  return (
    <p role={role} className="flex items-start gap-2.5 rounded-md border bg-card px-3.5 py-2.5 text-sm text-foreground">
      <span aria-hidden className={cn('mt-[7px] size-[7px] shrink-0 rounded-full', NOTICE_DOT[tone])} />
      <span>{children}</span>
    </p>
  );
}

export function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-[3px] size-4" />
      <span>{label}</span>
    </label>
  );
}
