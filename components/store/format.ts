/** Dates on buyer and seller screens are Indian dates, whatever the server's time zone. */
export const istDate = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
