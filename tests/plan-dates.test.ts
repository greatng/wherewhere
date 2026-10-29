import { describe, expect, it } from "vitest";
import { addCalendarDays, expandDateRange, parseCalendarDate } from "../src/features/plan/dates";

describe("Plan calendar ranges", () => {
  it("expands both endpoints as inclusive calendar dates across month and year boundaries", () => {
    expect(expandDateRange("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("keeps calendar days stable through leap day", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("rejects invalid dates, reversed ranges, and excessively long ranges", () => {
    expect(() => parseCalendarDate("2026-02-29")).toThrow();
    expect(() => expandDateRange("2026-03-02", "2026-03-01")).toThrow();
    expect(() => expandDateRange("2025-01-01", "2026-01-02")).toThrow();
  });
});
