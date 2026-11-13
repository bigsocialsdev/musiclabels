import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_PERMISSIONS, PermissionError, type AdminPermission } from '@/lib/identity';
import { closeDb, getDb } from '@/lib/platform/db';
import { ADMIN_CALLS } from './admin-calls';

afterAll(closeDb);
const db = getDb();
const admin = (permissions: AdminPermission[]) => ({ userId: '00000000-0000-7000-8000-0000000000aa', permissions });

/** Resolves to the error a call threw (null when it ran): only a PermissionError says the gate said no. */
const outcome = (call: (typeof ADMIN_CALLS)[number], permissions: AdminPermission[]) => call.run(db, admin(permissions)).then(() => null, (e: unknown) => e);

describe('admin permission matrix (PLAN §9)', () => {
  it('lists every call once', () => {
    expect(new Set(ADMIN_CALLS.map((c) => c.name)).size).toBe(ADMIN_CALLS.length);
  });

  it.each(ADMIN_CALLS.map((c) => [c.name, c] as const))('%s: refused without the permission, allowed with it and for a superadmin', async (_name, call) => {
    expect(await outcome(call, [])).toBeInstanceOf(PermissionError);
    for (const p of ADMIN_PERMISSIONS) {
      if (p === 'superadmin') continue;
      const refused = (await outcome(call, [p])) instanceof PermissionError;
      expect(refused, `${call.name} with only "${p}"`).toBe(call.permission !== 'any' && p !== call.permission);
    }
    expect(await outcome(call, ['superadmin'])).not.toBeInstanceOf(PermissionError);
  });
});
