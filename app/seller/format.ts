/** Dates the way Indian sellers read them, in IST whatever the server's time zone. */
export const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

/** Integer paise as a plain rupee amount for a CSV ("1234.50"), by integer arithmetic, never float division. */
export function rupees(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
