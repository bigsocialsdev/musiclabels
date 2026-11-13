import type { AdminPermission } from '@/lib/identity';

/** The admin areas that exist, in tab order, with the permission each needs (PLAN §9). Areas are added here as they are built. */
export const AREAS: readonly { href: string; label: string; permission: AdminPermission }[] = [
  { href: '/admin/verification', label: 'Verification', permission: 'verification' },
  { href: '/admin/clearance', label: 'Clearance', permission: 'clearance' },
  { href: '/admin/disputes', label: 'Disputes', permission: 'disputes' },
  { href: '/admin/complaints', label: 'Complaints', permission: 'disputes' },
];

export const visibleAreas = (permissions: readonly AdminPermission[]) =>
  AREAS.filter((a) => permissions.includes('superadmin') || permissions.includes(a.permission));
