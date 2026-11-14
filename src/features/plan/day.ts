/** Return the stay covering a destination-local calendar day. Check-out is exclusive. */
export function stayForDate<T extends { check_in_date: string; check_out_date: string }>(
  stays: readonly T[],
  date: string,
): T | undefined {
  return stays.find(
    (stay) => stay.check_in_date <= date && date < stay.check_out_date,
  );
}
