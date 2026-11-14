/** Sidebar icons for the console shell (no icon package; one 1.8 stroke, 16px). Decorative: links carry the labels. */
const PATHS = {
  onboarding: 'M9 11l3 3 8-8 M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  tracks: 'M9 18V5l12-2v13 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sales: 'M3 3v18h18 M7 15l4-4 3 3 5-6',
  payouts: 'M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M2 10h20 M6 15h4',
  clearance: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z M9 12l2 2 4-4',
  verification: 'M9 12l2 2 4-4 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  disputes: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M12 7v4 M12 14h.01',
  complaints: 'M4 22V4 M4 4h12l-2 4 2 4H4',
  refunds: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  reconciliation: 'M7 4L3 8l4 4 M3 8h14 M17 20l4-4-4-4 M21 16H7',
  alerts: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  enquiries: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
  catalog: 'M4 4h4v16H4z M10 4h4v16h-4z M16.5 4.5l3.8 15',
  kyc: 'M3 5h18v14H3z M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5 16c.6-1.8 1.8-3 3-3s2.4 1.2 3 3 M14 9h4 M14 13h4',
  accounts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  legal: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5',
  audit: 'M3 12a9 9 0 1 0 9-9 M3 4v5h5 M12 7v5l3 2',
} as const;

export type ConsoleIcon = keyof typeof PATHS;

export function Icon({ name }: { name: ConsoleIcon }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={PATHS[name]} />
    </svg>
  );
}
