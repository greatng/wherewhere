import { describe, expect, it } from "vitest";
import { todayStops } from "../src/features/trips/today";

const trip = { start_date: "2026-11-02", end_date: "2026-11-04" };
const stops = [
  {
    id: "late",
    starts_at: "2026-11-02T05:00:00Z",
    plan_date: "2026-11-02",
    position: 9,
  },
  {
    id: "early",
    starts_at: "2026-11-02T02:00:00Z",
    plan_date: "2026-11-02",
    position: 1,
  },
  { id: "untimed", starts_at: null, plan_date: "2026-11-02", position: 10 },
  {
    id: "yesterday",
    starts_at: "2026-11-01T10:00:00Z",
    plan_date: "2026-11-01",
    position: 2,
  },
];

describe("Today stop selection", () => {
  it("uses the trip-local date, orders timestamps, and includes untimed day stops", () => {
    const result = todayStops(
      stops,
      trip,
      new Date("2026-11-02T03:00:00Z"),
      "Asia/Bangkok",
    );
    expect(result.day).toBe("2026-11-02");
    expect(result.current?.id).toBe("early");
    expect(result.next?.id).toBe("late");
  });

  it("never carries yesterday's last stop into today's next stop", () => {
    const result = todayStops(
      stops,
      trip,
      new Date("2026-11-03T02:00:00Z"),
      "Asia/Bangkok",
    );
    expect(result.next).toBeUndefined();
    expect(result.state).toBe("day-finished");
  });

  it("reports the trip boundary states explicitly", () => {
    expect(
      todayStops(stops, trip, new Date("2026-11-01T00:00Z"), "Asia/Bangkok")
        .state,
    ).toBe("before-trip");
    expect(
      todayStops(stops, trip, new Date("2026-11-05T00:00Z"), "Asia/Bangkok")
        .state,
    ).toBe("trip-finished");
  });

  it("finishes the day after the last timed stop and preserves a manual last stop as current", () => {
    const onlyStop = [
      {
        id: "last",
        starts_at: "2026-11-02T05:00:00Z",
        plan_date: "2026-11-02",
        position: 7,
      },
    ];
    const after = new Date("2026-11-02T06:00:00Z");
    expect(todayStops(onlyStop, trip, after, "Asia/Bangkok").state).toBe(
      "day-finished",
    );
    expect(
      todayStops(onlyStop, trip, after, "Asia/Bangkok", "last"),
    ).toMatchObject({
      state: "active",
      current: { id: "last" },
      next: undefined,
    });
  });
});
