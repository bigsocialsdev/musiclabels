export type Rendered = { subject: string; html: string };

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Template name -> renderer. Slices add their templates here as their milestones land. */
const templates: Record<string, (p: Record<string, unknown>) => Rendered> = {
  system_alert: (p) => ({
    subject: `[Alert] ${esc(p.title)}`,
    html: `<p>${esc(p.message)}</p>`,
  }),
  refund_processed: (p) => ({
    subject: `Refund processed for ${esc(p.trackTitle)}`,
    html:
      `<p>We have refunded ₹${esc((Number(p.amountPaise) / 100).toFixed(2))} for “${esc(p.trackTitle)}”. Banks usually take 5–7 working days to show it.</p>` +
      (p.creditNoteNumber ? `<p>Credit note ${esc(p.creditNoteNumber)} is on your account page. The license is no longer valid.</p>` : ''),
  }),
  payout_paid: (p) => ({
    subject: `Royalty payout for ${esc(p.period)}`,
    html: `<p>Your royalty payout for ${esc(p.period)} of ₹${esc((Number(p.netPaise) / 100).toFixed(2))} was paid (UTR ${esc(p.utr)}). Your statement is in the seller portal.</p>`,
  }),
  license_issued: (p) => ({
    subject: `Your license for ${esc(p.trackTitle)}`,
    html:
      `<p>Your license <strong>${esc(p.publicId)}</strong> for “${esc(p.trackTitle)}” is issued (invoice ${esc(p.invoiceNumber)}).</p>` +
      `<p>Certificate, invoice, license text and downloads are on your license page. Anyone can check it at <a href="${esc(p.verifyUrl)}">${esc(p.verifyUrl)}</a>.</p>` +
      `<p>Clearance is a process: register each video on your license page before publishing.</p>`,
  }),
};

export function render(template: string, payload: Record<string, unknown>): Rendered {
  const t = templates[template];
  if (!t) throw new Error(`Unknown email template: ${template}`);
  return t(payload);
}
