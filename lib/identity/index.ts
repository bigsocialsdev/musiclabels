// Types safe to import anywhere (client or server).
export const ADMIN_PERMISSIONS = ['verification', 'clearance', 'disputes', 'finance', 'superadmin'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Post-login redirect target: same-origin paths only (blocks open redirects like //evil.com or /\evil.com). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  // Control characters (tab, CR, LF...) are stripped by browsers/URL parsers, so "/\t/evil.com" would become "//evil.com".
  // Backslashes are treated as slashes by browsers. Reject both.
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

/** Who is calling, as established by Supabase Auth for this request. */
export type Session = {
  userId: string;
  email: string | null;
  phone: string | null;
  /** The user confirmed an email or phone (OTP / OAuth). */
  verified: boolean;
  /** aal2 = signed in with a TOTP factor. */
  aal: 'aal1' | 'aal2';
};

export type AdminContext = { userId: string; permissions: readonly AdminPermission[] };

export type GuardFailure = 'unauthenticated' | 'unverified' | 'mfa_required' | 'forbidden';
export type Guard<T> = { ok: true; value: T } | { ok: false; reason: GuardFailure };

/** Thrown when an admin lacks the permission for an action. superadmin implies every permission. */
export class PermissionError extends Error {}

/** A signed-in user acting for one of their organisations (the org id is checked against memberships, not trusted). */
export type OrgActor = { userId: string; orgId: string };

/** The caller is not a member of the org. Slices' seller-facing read sides throw it. */
export class OrgAccessError extends Error {
  constructor() {
    super('forbidden');
  }
}

export function requirePermission(admin: AdminContext, permission: AdminPermission): void {
  if (!admin.permissions.includes('superadmin') && !admin.permissions.includes(permission)) {
    throw new PermissionError(`This action requires the ${permission} permission`);
  }
}
