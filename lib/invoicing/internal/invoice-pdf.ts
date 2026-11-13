import { createElement as h } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { GST_STATES } from '../index';
import type { CreditNote, Invoice } from './invoices';

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

type Amounts = Pick<Invoice, 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise'>;

/** One layout for both tax documents: parties and place of supply come from the invoice. */
function taxDocument(heading: string, number: string, header: [string, string][], inv: Invoice, amounts: Amounts) {
  const taxes = amounts.igstPaise
    ? [line(`IGST @ ${inv.gstRateBps / 100}%`, inr(amounts.igstPaise))]
    : [line(`CGST @ ${inv.gstRateBps / 200}%`, inr(amounts.cgstPaise)), line(`SGST @ ${inv.gstRateBps / 200}%`, inr(amounts.sgstPaise))];
  return h(
    Document,
    { title: `${heading} ${number}` },
    h(
      Page,
      { size: 'A4', style: s.page },
      h(Text, { style: s.h1 }, heading),
      h(View, { style: s.block }, ...header.map(([k, v]) => line(k, v)), line('Place of supply', state(inv.placeOfSupplyState))),
      h(View, { style: s.block }, h(Text, { style: s.label }, 'Supplier'), h(Text, null, inv.supplierName), h(Text, null, inv.supplierAddress), h(Text, null, `GSTIN ${inv.supplierGstin} · ${state(inv.supplierStateCode)}`)),
      h(
        View,
        { style: s.block },
        h(Text, { style: s.label }, 'Recipient'),
        h(Text, null, inv.recipientName),
        inv.recipientAddress ? h(Text, null, inv.recipientAddress) : null,
        h(Text, null, `${inv.recipientGstin ? `GSTIN ${inv.recipientGstin} · ` : ''}${state(inv.recipientStateCode)}`),
      ),
      h(View, { style: s.block }, line('Description', inv.lineDescription), line('SAC', inv.sacCode), line('Taxable value', inr(amounts.taxablePaise)), ...taxes),
      h(View, { style: s.total }, h(Text, null, 'Total'), h(Text, null, inr(amounts.totalPaise))),
    ),
  );
}

export function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  return renderToBuffer(taxDocument('Tax Invoice', inv.number, [['Invoice number', inv.number], ['Date', ist(inv.issuedAt)]], inv, inv));
}

export function renderCreditNotePdf(note: CreditNote, inv: Invoice): Promise<Buffer> {
  return renderToBuffer(
    taxDocument(
      'Credit Note',
      note.number,
      [['Credit note number', note.number], ['Date', ist(note.issuedAt)], ['Against invoice', `${inv.number} of ${ist(inv.issuedAt)}`], ['Reason', note.reason]],
      inv,
      note,
    ),
  );
}
