import type { ReactNode } from 'react';
import { adminPermissionsOf, loadSession } from '@/lib/identity/server';
import { visibleAreas } from './areas';
import { AdminNav } from './nav';

/** Console shell (DESIGN.md): a 52px bar with the wordmark, "Admin", the areas this admin may open and their MFA state. Pages gate themselves. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await loadSession();
  const permissions = await adminPermissionsOf(session);
  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex h-13 max-w-6xl items-stretch gap-6 px-5">
          <span className="flex items-center gap-[7px] text-[17px] font-bold tracking-[-0.03em]">
            <span aria-hidden className="size-2 rounded-full bg-signal" />
            MRM <span className="text-[13px] font-semibold tracking-normal text-muted-foreground">Admin</span>
          </span>
          {permissions && <AdminNav areas={visibleAreas(permissions)} />}
          {session && permissions && (
            <span className="ml-auto flex items-center gap-3 text-[13px] text-muted-foreground">
              <span className="hidden max-w-48 truncate sm:inline">{session.email}</span>
              {session.aal === 'aal2' && <span className="rounded-full border border-ok px-2 py-0.5 text-xs font-semibold text-ok">MFA on</span>}
            </span>
          )}
        </div>
      </header>
      {children}
    </>
  );
}
