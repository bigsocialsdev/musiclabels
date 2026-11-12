import { createElement as h } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { GST_STATES } from '../index';
import type { Invoice } from './invoices';

// Built-in Helvetica has no ₹ or Indic glyphs, so amounts print as "INR"; see STATE (S3-M4) for the font follow-up.
const inr = (p: number) => `INR ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const state = (code: string) => `${GST_STATES[code] ?? 'Unknown'} (${code})`;
const ist = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  h1: { fontSize: 16, marginBottom: 12, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  block: { marginBottom: 14 },
  label: { color: '#555' },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, fontFamily: 'Helvetica-Bold' },
});

const line = (label: string, value: string) => h(View, { style: s.row }, h(Text, { style: s.label }, label), h(Text, null, value));

export async function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  const taxes = inv.igstPaise
    ? [line(`IGST @ ${inv.gstRateBps / 100}%`, inr(inv.igstPaise))]
    : [line(`CGST @ ${inv.gstRateBps / 200}%`, inr(inv.cgstPaise)), line(`SGST @ ${inv.gstRateBps / 200}%`, inr(inv.sgstPaise))];
  const doc = h(
    Document,
    { title: `Tax invoice ${inv.number}` },
    h(
      Page,
      { size: 'A4', style: s.page },
      h(Text, { style: s.h1 }, 'Tax Invoice'),
      h(View, { style: s.block }, line('Invoice number', inv.number), line('Date', ist(inv.issuedAt)), line('Place of supply', state(inv.placeOfSupplyState))),
      h(View, { style: s.block }, h(Text, { style: s.label }, 'Supplier'), h(Text, null, inv.supplierName), h(Text, null, inv.supplierAddress), h(Text, null, `GSTIN ${inv.supplierGstin} · ${state(inv.supplierStateCode)}`)),
      h(
        View,
        { style: s.block },
        h(Text, { style: s.label }, 'Recipient'),
        h(Text, null, inv.recipientName),
        inv.recipientAddress ? h(Text, null, inv.recipientAddress) : null,
        h(Text, null, `${inv.recipientGstin ? `GSTIN ${inv.recipientGstin} · ` : ''}${state(inv.recipientStateCode)}`),
      ),
      h(View, { style: s.block }, line('Description', inv.lineDescription), line('SAC', inv.sacCode), line('Taxable value', inr(inv.taxablePaise)), ...taxes),
      h(View, { style: s.total }, h(Text, null, 'Total'), h(Text, null, inr(inv.totalPaise))),
    ),
  );
  return renderToBuffer(doc);
}
