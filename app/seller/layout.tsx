import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/console/shell';
import type { ConsoleNavItem } from '@/components/console/nav';

const ITEMS: readonly ConsoleNavItem[] = [
  { href: '/seller/onboarding', label: 'Onboarding', icon: 'onboarding' },
  { href: '/seller/tracks', label: 'Tracks', icon: 'tracks' },
  { href: '/seller/sales', label: 'Sales', icon: 'sales' },
  { href: '/seller/payouts', label: 'Payouts', icon: 'payouts' },
  { href: '/seller/clearance', label: 'Clearance', icon: 'clearance' },
];

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell product="Seller" navLabel="Seller" items={ITEMS}>
      {children}
    </ConsoleShell>
  );
}
