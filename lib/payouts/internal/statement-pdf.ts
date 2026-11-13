import { createElement as h } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

const inr = (p: number) => `INR ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  h1: { fontSize: 16, marginBottom: 12, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, fontFamily: 'Helvetica-Bold' },
  note: { marginTop: 16, color: '#555', fontSize: 9 },
});
const line = (k: string, v: string) => h(View, { style: s.row }, h(Text, null, k), h(Text, null, v));

export type StatementData = {
  sellerName: string;
  period: string;
  utr: string;
  paidAt: Date;
  royaltyBasePaise: number;
  tdsPaise: number;
  sellerGstPaise: number;
  rcmGstPaise: number;
  netPaise: number;
};

export function renderPayoutStatement(d: StatementData): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      { title: `Royalty statement ${d.period}` },
      h(
        Page,
        { size: 'A4', style: s.page },
        h(Text, { style: s.h1 }, `Royalty statement — ${d.period}`),
        line('Seller', d.sellerName),
        line('Paid on', d.paidAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })),
        line('UTR', d.utr),
        line('Royalty (taxable value share)', inr(d.royaltyBasePaise)),
        d.sellerGstPaise ? line('GST on royalty (forward charge)', inr(d.sellerGstPaise)) : null,
        d.tdsPaise ? line('TDS withheld', `- ${inr(d.tdsPaise)}`) : null,
        h(View, { style: s.total }, h(Text, null, 'Paid to you'), h(Text, null, inr(d.netPaise))),
        d.rcmGstPaise ? h(Text, { style: s.note }, `GST of ${inr(d.rcmGstPaise)} on this royalty is paid by the platform under reverse charge.`) : null,
        h(Text, { style: s.note }, 'Royalties are computed on the pre-GST value of each sale and become payable 30 days after payment.'),
      ),
    ),
  );
}
