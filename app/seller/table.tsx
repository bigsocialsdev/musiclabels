import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Console table (DESIGN.md queue table): card surface, hairline rows, sticky header, 20px gutter. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-[13.5px]">{children}</table>
    </div>
  );
}

export function Th({ children, num }: { children?: ReactNode; num?: boolean }) {
  return <th className={cn('border-b px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5', num ? 'text-right' : 'text-left')}>{children}</th>;
}

export function Td({ children, num, mono, className }: { children?: ReactNode; num?: boolean; mono?: boolean; className?: string }) {
  return (
    <td className={cn('border-b px-3 py-2.5 align-middle first:pl-5 last:pr-5 [tr:last-child_&]:border-b-0', num && 'text-right', (num || mono) && 'font-mono text-[13px] font-normal', className)}>
      {children}
    </td>
  );
}
