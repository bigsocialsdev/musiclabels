/** Dates on buyer and seller screens are Indian dates, whatever the server's time zone. */
export const istDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export const PLATFORM_LABELS: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' };

/** A due time, to the minute: the 48-hour dispute target needs more than a date. */
export const istDateTime = (d: Date) =>
  d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' IST';
