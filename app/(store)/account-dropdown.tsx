'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { DropdownMenu } from 'radix-ui';
import { buttonVariants } from '@/components/ui/button';
import { signOut } from '@/app/auth/actions';
import { signInHref, type AccountLink } from './account-links';

export function SignInLink() {
  return (
    <Link href={signInHref(usePathname())} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
      Sign in
    </Link>
  );
}

const item = 'flex h-9 cursor-pointer items-center rounded-sm px-2.5 text-sm font-semibold text-fg-2 outline-none select-none data-[highlighted]:bg-secondary data-[highlighted]:text-foreground';

/** The portal renders outside the storefront's `.dark` wrapper, so the menu carries the class itself. */
export function AccountDropdown({ identity, links }: { identity: string; links: AccountLink[] }) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={`${buttonVariants({ variant: 'secondary', size: 'lg' })} max-w-56 px-3.5 max-[900px]:px-2`} aria-label={`Account: ${identity}`}>
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold uppercase">
          {identity.charAt(0)}
        </span>
        <span className="truncate max-[900px]:hidden">{identity}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="dark z-50 w-64 rounded-md border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_28px_-10px_rgba(0,0,0,.6)]">
          <div className="px-2.5 pt-1.5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-semibold">{identity}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {links.map((l) => (
            <DropdownMenu.Item key={l.href} asChild className={item}>
              <Link href={l.href}>{l.label}</Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} disabled={pending} onSelect={() => start(() => signOut())}>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
