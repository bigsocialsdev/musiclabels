import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { SearchBox } from './search-box';

/**
 * The storefront group is always the night theme (DESIGN.md): buyers audition music in a dark room where the waveform is
 * the brightest object. Seller and admin surfaces stay in daylight. The inline rule paints the page behind it dark too,
 * so overscroll never flashes the light ground.
 */
export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <style>{'html{background:var(--night-ground);color-scheme:dark}'}</style>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-background/90 px-6 backdrop-blur-md max-[900px]:h-14 max-[900px]:px-4">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-[-0.035em]">
          <span aria-hidden className="size-[9px] rounded-full bg-signal" />
          MRM
        </Link>
        <SearchBox className="ml-6 max-w-[560px] flex-1 max-[900px]:hidden" />
        <nav aria-label="Main" className="ml-auto flex items-center gap-1.5">
          <Link href="/" className="rounded-sm px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">
            Browse
          </Link>
          <Link href="/auth/sign-in" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Sign in
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
