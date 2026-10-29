/** Parse an ISO calendar date without interpreting it in the device timezone. */
export function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return date;
}

export function formatCalendarDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date);
}

/** Inclusive, calendar-day expansion. Date-only strings never pass through local time. */
export function expandDateRange(start: string, end: string): string[] {
  const first = parseCalendarDate(start);
  const last = parseCalendarDate(end);
  if (last < first) throw new RangeError("Range end must not precede start");
  const count = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
  if (count > 366) throw new RangeError("Range cannot exceed 366 nights");
  return Array.from({ length: count }, (_, index) =>
    addCalendarDays(start, index),
  );
}

export function formatDateLabel(value: string, locale: string): string {
  const date = parseCalendarDate(value);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
