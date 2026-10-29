import { describe, expect, it } from "vitest";
import { tripWallTimeToIso } from "../src/features/plan/timezone";

describe("Plan activity wall times", () => {
  it("converts using the trip timezone instead of the device timezone", () => {
    expect(tripWallTimeToIso("2026-03-15T09:30", "Asia/Bangkok")).toBe("2026-03-15T02:30:00.000Z");
  });

  it("rejects local times skipped by a daylight saving clock change", () => {
    expect(() => tripWallTimeToIso("2026-03-08T02:30", "America/New_York")).toThrow(/does not exist/);
  });
});
