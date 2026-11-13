import { createElement as h, type ReactElement } from 'react';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { CLEARANCE_NOTICE, TIER_LABELS } from '../index';

// Built-in Helvetica has no Indic glyphs; see STATE (S3-M4) for the embedded-font follow-up.
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  h1: { fontSize: 18, marginBottom: 4, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 12, marginTop: 14, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555' },
  row: { flexDirection: 'row', marginBottom: 3 },
  label: { width: 130, color: '#555' },
  value: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  qr: { width: 96, height: 96 },
  notice: { marginTop: 18, padding: 8, borderWidth: 1, borderColor: '#999', fontSize: 9 },
  mono: { fontFamily: 'Courier', fontSize: 9 },
});

const field = (label: string, value: string) => h(View, { style: s.row }, h(Text, { style: s.label }, label), h(Text, { style: s.value }, value));
const ist = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' });

export type CertificateData = {
  publicId: string;
  recordHash: string;
  verifyUrl: string;
  revision: number;
  trackTitle: string;
  primaryArtist: string;
  tier: keyof typeof TIER_LABELS;
  licenseeDisplay: string;
  purchaserName: string | null; // set when an agency bought for a client
  editsAllowed: boolean;
  territory: string;
  startsAt: Date;
  endsAt: Date | null;
  licenseTextVersion: number;
  videoCap: number | null;
  channels: { platform: string; handleOrUrl: string }[];
  issuedAt: Date;
};

const term = (d: CertificateData) => (d.endsAt ? `${ist(d.startsAt)} to ${ist(d.endsAt)}` : `Perpetual from ${ist(d.startsAt)}`);
const permitted = (d: CertificateData) =>
  `${TIER_LABELS[d.tier]} use${d.videoCap ? `, up to ${d.videoCap} video${d.videoCap > 1 ? 's' : ''}` : ''}${d.editsAllowed ? '; edits permitted' : '; no edits'}`;

function summary(d: CertificateData, qr: string): ReactElement[] {
  return [
    h(
      View,
      { style: s.header, key: 'h' },
      h(View, null, h(Text, { style: s.h1 }, 'License Certificate'), h(Text, { style: s.muted }, d.publicId), h(Text, { style: s.muted }, `Revision ${d.revision} · issued ${ist(d.issuedAt)}`)),
      h(Image, { src: qr, style: s.qr }),
    ),
    h(
      View,
      { key: 'f' },
      field('Track', `${d.trackTitle} — ${d.primaryArtist}`),
      field('Licensee', d.licenseeDisplay),
      d.purchaserName ? field('Purchased by', d.purchaserName) : null,
      field('Permitted use', permitted(d)),
      field('Term', term(d)),
      field('Territory', d.territory === 'worldwide' ? 'Worldwide (online distribution)' : d.territory),
      field('Channels', d.channels.map((c) => `${c.platform}: ${c.handleOrUrl}`).join('\n') || '—'),
      field('License text', `Version ${d.licenseTextVersion}`),
      field('Verify', d.verifyUrl),
      field('Record hash', d.recordHash.slice(0, 16)),
    ),
  ];
}

export async function renderCertificatePdf(d: CertificateData): Promise<Buffer> {
  const qr = await QRCode.toDataURL(d.verifyUrl, { margin: 1, width: 240 });
  return renderToBuffer(
    h(Document, { title: `License ${d.publicId}` }, h(Page, { size: 'A4', style: s.page }, ...summary(d, qr), h(Text, { style: s.notice }, CLEARANCE_NOTICE))),
  );
}

// Suggested wording per platform. Placeholder copy pending counsel ([Lawyer]); never promises an outcome.
const DISPUTE_WORDING: [string, string][] = [
  [
    'YouTube Content ID claim',
    'Dispute the claim and choose "I have a license or written permission". Paste: "This video uses <track> under license <license id>, verifiable at <verify url>." Then report the claim from your license page so we can contact the rights holder.',
  ],
  [
    'YouTube copyright strike (takedown)',
    'Do not file a counter-notification before contacting us: report it from your license page first. A counter-notification is a legal statement; we will help you decide whether it is appropriate.',
  ],
  ['Meta (Facebook / Instagram) Rights Manager claim', 'Use "Dispute" and state that you hold a license, quoting the license id and verify URL. Report it from your license page.'],
  ['Meta ad rejected for music', 'Appeal the decision quoting the license id and verify URL. Ad review outcomes are decided by Meta; report it from your license page so we can supply evidence.'],
];

export async function renderDisputeKitPdf(d: CertificateData, licenseText: string): Promise<Buffer> {
  const qr = await QRCode.toDataURL(d.verifyUrl, { margin: 1, width: 240 });
  const fill = (t: string) => t.replaceAll('<track>', `"${d.trackTitle}" by ${d.primaryArtist}`).replaceAll('<license id>', d.publicId).replaceAll('<verify url>', d.verifyUrl);
  return renderToBuffer(
    h(
      Document,
      { title: `Dispute kit ${d.publicId}` },
      h(
        Page,
        { size: 'A4', style: s.page },
        ...summary(d, qr),
        h(Text, { style: s.h2 }, 'If your video is claimed'),
        ...DISPUTE_WORDING.flatMap(([title, body], i) => [h(Text, { style: { fontFamily: 'Helvetica-Bold', marginTop: 6 }, key: `t${i}` }, title), h(Text, { key: `b${i}` }, fill(body))]),
        h(Text, { style: s.notice }, CLEARANCE_NOTICE),
      ),
      h(Page, { size: 'A4', style: s.page }, h(Text, { style: s.h2 }, `License text (version ${d.licenseTextVersion})`), h(Text, { style: s.mono }, licenseText)),
    ),
  );
}
