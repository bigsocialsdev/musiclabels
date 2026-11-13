const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

/** Saturday or Sunday in India. There is no holiday calendar (PLAN §13: "business day" = Monday to Friday). */
export function isWeekendIst(d: Date): boolean {
  const day = new Date(d.getTime() + IST_OFFSET_MS).getUTCDay();
  return day === 0 || day === 6;
}

/** `days` business days after `from`, same time of day: Friday 10:00 + 1 is Monday 10:00. */
export function addBusinessDays(from: Date, days: number): Date {
  let d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY_MS);
    if (!isWeekendIst(d)) left--;
  }
  return d;
}
