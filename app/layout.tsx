import type { Metadata } from 'next';
import { Hanken_Grotesk, Red_Hat_Mono } from 'next/font/google';
import './globals.css';

const sans = Hanken_Grotesk({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-hanken' });
const mono = Red_Hat_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-redhat-mono' });

export const metadata: Metadata = {
  title: 'Music Rights Marketplace',
  description: 'Sync licensing for a curated, claim-safe catalog.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
