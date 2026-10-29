function partsAt(instant: Date, timeZone: string) {
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(fields.map(({ type, value }) => [type, value]));
}

function stamp(parts: Record<string, string>) {
  return Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
}

/** Convert a wall-clock value in the trip timezone without using the device timezone. */
export function tripWallTimeToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Enter a valid activity date and time.");
  const [, year, month, day, hour, minute] = match;
  const target = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  const validDate = new Date(target);
  if (
    validDate.getUTCFullYear() !== +year ||
    validDate.getUTCMonth() !== +month - 1 ||
    validDate.getUTCDate() !== +day ||
    +hour > 23 ||
    +minute > 59
  ) {
    throw new RangeError("Enter a valid activity date and time.");
  }
  // Collect possible offsets around the target instant. This also identifies both
  // occurrences of a repeated clock time when daylight saving time ends.
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const instant = new Date(target + delta * 3_600_000);
    offsets.add(stamp(partsAt(instant, timeZone)) - instant.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((instant) => {
      const p = partsAt(instant, timeZone);
      return (
        p.year === year &&
        p.month === month &&
        p.day === day &&
        p.hour === hour &&
        p.minute === minute &&
        p.second === "00"
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (!candidates.length)
    throw new RangeError(
      "That local time does not exist in the trip timezone because of a clock change.",
    );
  // During a fall-back transition, choose the earlier occurrence consistently.
  return candidates[0].toISOString();
}
