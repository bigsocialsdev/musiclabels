'use client';
import { useRouter } from 'next/navigation';

/** Sort order. Each option is its own URL (built by the page), so this only navigates. */
export function SortSelect({ value, options }: { value: string; options: { value: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground max-[900px]:hidden">
      Sort
      <select
        value={value}
        onChange={(e) => router.push(options.find((o) => o.value === e.target.value)!.href)}
        className="rounded-sm border bg-card px-2 py-1.5 text-[13px] font-semibold text-foreground outline-none focus-visible:border-fg-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
