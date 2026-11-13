'use client';
import { useEffect, useId, useRef } from 'react';
import { SearchIcon } from '@/components/store/icons';
import { cn } from '@/lib/utils';

/** The search field (top bar on desktop, under it on phones). "/" jumps to whichever one is showing. */
export function SearchBox({ defaultValue, className }: { defaultValue?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest('input,select,textarea')) return;
      if (ref.current && ref.current.offsetParent !== null) {
        e.preventDefault();
        ref.current.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <form action="/" role="search" className={cn('flex h-11 items-center gap-2.5 rounded-sm border bg-card px-3.5 text-muted-foreground focus-within:border-fg-2', className)}>
      <SearchIcon />
      <label htmlFor={id} className="sr-only">
        Search tracks, moods, artists
      </label>
      <input
        ref={ref}
        id={id}
        name="q"
        type="search"
        defaultValue={defaultValue}
        maxLength={100}
        autoComplete="off"
        placeholder="Search tracks, moods, artists"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <kbd className="rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium max-[900px]:hidden">/</kbd>
    </form>
  );
}
