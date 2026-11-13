import type { AdminPermission } from '@/lib/identity';

export type AreaPermission = AdminPermission | 'any';

/** The admin areas that exist, in tab order, with the permission each needs (PLAN §9). Areas are added here as they are built. */
export const AREAS: readonly { href: string; label: string; permission: AreaPermission }[] = [
  { href: '/admin/verification', label: 'Verification', permission: 'verification' },
  { href: '/admin/clearance', label: 'Clearance', permission: 'clearance' },
  { href: '/admin/disputes', label: 'Disputes', permission: 'disputes' },
  { href: '/admin/complaints', label: 'Complaints', permission: 'disputes' },
  { href: '/admin/refunds', label: 'Refunds', permission: 'finance' },
  { href: '/admin/payouts', label: 'Payouts', permission: 'finance' },
  { href: '/admin/reconciliation', label: 'Reconciliation', permission: 'finance' },
  { href: '/admin/alerts', label: 'Alerts', permission: 'any' },
  { href: '/admin/enquiries', label: 'Enquiries', permission: 'any' },
  { href: '/admin/catalog', label: 'Catalog', permission: 'verification' },
  { href: '/admin/kyc', label: 'KYC', permission: 'verification' },
  { href: '/admin/accounts', label: 'Users and orgs', permission: 'superadmin' },
  { href: '/admin/legal', label: 'Legal', permission: 'superadmin' },
  { href: '/admin/audit', label: 'Audit log', permission: 'superadmin' },
];

export const visibleAreas = (permissions: readonly AdminPermission[]) =>
  AREAS.filter((a) => a.permission === 'any' ? permissions.length > 0 : permissions.includes('superadmin') || permissions.includes(a.permission));
