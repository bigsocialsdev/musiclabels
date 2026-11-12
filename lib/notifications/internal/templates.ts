export type Rendered = { subject: string; html: string };

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Template name -> renderer. Slices add their templates here as their milestones land. */
const templates: Record<string, (p: Record<string, unknown>) => Rendered> = {
  system_alert: (p) => ({
    subject: `[Alert] ${esc(p.title)}`,
    html: `<p>${esc(p.message)}</p>`,
  }),
};

export function render(template: string, payload: Record<string, unknown>): Rendered {
  const t = templates[template];
  if (!t) throw new Error(`Unknown email template: ${template}`);
  return t(payload);
}
