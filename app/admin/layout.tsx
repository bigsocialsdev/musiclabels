import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console/shell';
import { adminPermissionsOf, loadSession } from '@/lib/identity/server';
import { visibleAreas } from './areas';

/** Console shell (DESIGN.md): sidebar with the areas this admin may open, and their identity and MFA state at the foot. Pages gate themselves. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await loadSession();
  const permissions = await adminPermissionsOf(session);
  const footer =
    session && permissions ? (
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground md:flex-col md:items-start md:gap-1.5">
        <span className="hidden max-w-full truncate sm:inline">{session.email}</span>
        {session.aal === 'aal2' && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">MFA on</span>}
      </div>
    ) : null;
  return (
    <ConsoleShell product="Admin" navLabel="Admin" items={permissions ? visibleAreas(permissions) : []} footer={footer}>
      {children}
    </ConsoleShell>
  );
}
