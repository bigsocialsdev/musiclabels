// Types safe to import anywhere (client or server).
export const ADMIN_PERMISSIONS = ['verification', 'clearance', 'disputes', 'finance', 'superadmin'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Post-login redirect target: same-origin paths only (blocks open redirects like //evil.com or /\evil.com). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next)) return fallback;
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
