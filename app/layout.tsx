import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Music Rights Marketplace',
  description: 'Sync licensing for a curated, claim-safe catalog.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
