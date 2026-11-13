/** Dates the way Indian sellers read them, in IST whatever the server's time zone. */
export const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
