import type { ReactNode } from 'react';
import { ConsoleNav, type ConsoleNavItem } from './nav';

function Wordmark({ product }: { product: string }) {
  return (
    <span className="flex items-center gap-[7px] text-[17px] font-bold tracking-[-0.03em]">
      <span aria-hidden className="size-2 rounded-full bg-signal" />
      MRM <span className="text-[13px] font-semibold tracking-normal text-muted-foreground">{product}</span>
    </span>
  );
}

/**
 * Console frame for the seller portal and the admin console (DESIGN.md, aligned with BigSocials): a sidebar on the shell
 * grey with the content on a raised panel; on phones the sidebar becomes a top bar with scrolling tabs.
 */
export function ConsoleShell({ product, navLabel, items, footer, children }: { product: string; navLabel: string; items: readonly ConsoleNavItem[]; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-shell md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 overflow-y-auto px-2 py-4 md:flex">
        <div className="px-2.5 pt-1 pb-2">
          <Wordmark product={product} />
        </div>
        <ConsoleNav items={items} label={navLabel} variant="side" />
        {footer && <div className="mt-auto px-2.5">{footer}</div>}
      </aside>
      <header className="sticky top-0 z-20 border-b bg-card md:hidden">
        <div className="flex h-12 items-center justify-between gap-3 px-5">
          <Wordmark product={product} />
          {footer}
        </div>
        <ConsoleNav items={items} label={navLabel} variant="bar" />
      </header>
      <div className="min-w-0 bg-background md:my-2 md:mr-2 md:min-h-[calc(100dvh-16px)] md:rounded-2xl md:border">{children}</div>
    </div>
  );
}
