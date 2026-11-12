export type TodayStop = {
  id: string;
  starts_at: string | null;
  plan_date?: string | null;
  position: number;
};

export function tripDateAt(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function stopsForTripDay<T extends TodayStop>(
  items: T[],
  day: string,
  timezone: string,
) {
  return items
    .filter((item) => {
      const itemDay = item.starts_at
        ? tripDateAt(new Date(item.starts_at), timezone)
        : item.plan_date;
      return itemDay === day;
    })
    .sort((a, b) => {
      if (a.starts_at && b.starts_at)
        return (
          a.starts_at.localeCompare(b.starts_at) || a.position - b.position
        );
      if (a.starts_at) return -1;
      if (b.starts_at) return 1;
      return a.position - b.position;
    });
}

export function todayStops<T extends TodayStop>(
  items: T[],
  trip: { start_date: string; end_date: string; status?: string },
  now: Date,
  timezone: string,
  chosenId?: string,
) {
  const day = tripDateAt(now, timezone);
  if (trip.status === "completed" || day > trip.end_date)
    return {
      day,
      state: "trip-finished" as const,
      current: undefined,
      next: undefined,
      completed: [] as T[],
    };
  if (day < trip.start_date)
    return {
      day,
      state: "before-trip" as const,
      current: undefined,
      next: undefined,
      completed: [] as T[],
    };
  const inTrip = day >= trip.start_date && day <= trip.end_date;
  const visibleDay = inTrip
    ? day
    : day < trip.start_date
      ? trip.start_date
      : trip.end_date;
  const stops = stopsForTripDay(items, visibleDay, timezone);
  const timed = stops.filter((item) => item.starts_at);
  const elapsed = timed.filter(
    (item) => new Date(item.starts_at!).getTime() <= now.getTime(),
  );
  const future = timed.find(
    (item) => new Date(item.starts_at!).getTime() > now.getTime(),
  );
  const current = chosenId
    ? stops.find((item) => item.id === chosenId)
    : future
      ? elapsed.at(-1)
      : undefined;
  const currentIndex = current
    ? stops.findIndex((item) => item.id === current.id)
    : -1;
  const next = current
    ? stops[currentIndex + 1]
    : (future ?? stops.find((item) => !item.starts_at));
  const completed = current
    ? stops.slice(0, currentIndex)
    : future
      ? elapsed
      : stops;
  const state =
    !next && !current ? ("day-finished" as const) : ("active" as const);
  return { day: visibleDay, state, current, next, completed };
}
