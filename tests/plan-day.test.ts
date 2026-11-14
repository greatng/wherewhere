import { describe, expect, it } from "vitest";
import { stayForDate } from "../src/features/plan/day";

describe("stayForDate", () => {
  const stays = [
    { id: "one", check_in_date: "2026-11-01", check_out_date: "2026-11-03" },
    { id: "two", check_in_date: "2026-11-03", check_out_date: "2026-11-05" },
  ];

  it("covers check-in through the night before exclusive check-out", () => {
    expect(stayForDate(stays, "2026-11-01")?.id).toBe("one");
    expect(stayForDate(stays, "2026-11-02")?.id).toBe("one");
    expect(stayForDate(stays, "2026-11-03")?.id).toBe("two");
    expect(stayForDate(stays, "2026-11-05")).toBeUndefined();
  });
});
