import type { ConsoleIcon } from '@/components/console/icons';
import type { AdminPermission } from '@/lib/identity';

export type AreaPermission = AdminPermission | 'any';

/** The admin areas that exist, in sidebar order, with the permission each needs (PLAN §9). Areas are added here as they are built. */
export const AREAS: readonly { href: string; label: string; icon: ConsoleIcon; permission: AreaPermission }[] = [
  { href: '/admin/verification', label: 'Verification', icon: 'verification', permission: 'verification' },
  { href: '/admin/clearance', label: 'Clearance', icon: 'clearance', permission: 'clearance' },
  { href: '/admin/disputes', label: 'Disputes', icon: 'disputes', permission: 'disputes' },
  { href: '/admin/complaints', label: 'Complaints', icon: 'complaints', permission: 'disputes' },
  { href: '/admin/refunds', label: 'Refunds', icon: 'refunds', permission: 'finance' },
  { href: '/admin/payouts', label: 'Payouts', icon: 'payouts', permission: 'finance' },
  { href: '/admin/reconciliation', label: 'Reconciliation', icon: 'reconciliation', permission: 'finance' },
  { href: '/admin/alerts', label: 'Alerts', icon: 'alerts', permission: 'any' },
  { href: '/admin/enquiries', label: 'Enquiries', icon: 'enquiries', permission: 'any' },
  { href: '/admin/catalog', label: 'Catalog', icon: 'catalog', permission: 'verification' },
  { href: '/admin/kyc', label: 'KYC', icon: 'kyc', permission: 'verification' },
  { href: '/admin/accounts', label: 'Users and orgs', icon: 'accounts', permission: 'superadmin' },
  { href: '/admin/legal', label: 'Legal', icon: 'legal', permission: 'superadmin' },
  { href: '/admin/audit', label: 'Audit log', icon: 'audit', permission: 'superadmin' },
];

export const visibleAreas = (permissions: readonly AdminPermission[]) =>
  AREAS.filter((a) => a.permission === 'any' ? permissions.length > 0 : permissions.includes('superadmin') || permissions.includes(a.permission));
