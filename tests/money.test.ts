import { describe, expect, it } from "vitest";
import {
  calculateBalances,
  splitAmount,
  suggestSettlements,
} from "../src/features/expenses/money";

describe("integer expense arithmetic", () => {
  it("splits remainder deterministically and reconciles exactly", () => {
    const shares = splitAmount(2000, ["a", "b", "c"]);
    expect(shares).toEqual([
      { memberId: "a", owedMinor: 667 },
      { memberId: "b", owedMinor: 667 },
      { memberId: "c", owedMinor: 666 },
    ]);
    expect(shares.reduce((sum, share) => sum + share.owedMinor, 0)).toBe(2000);
  });

  it("rejects zero, fractional, duplicate, and empty splits", () => {
    expect(() => splitAmount(0, ["a"])).toThrow();
    expect(() => splitAmount(1.5, ["a"])).toThrow();
    expect(() => splitAmount(10, ["a", "a"])).toThrow();
    expect(() => splitAmount(10, [])).toThrow();
  });

  it("uses exact bigint balances and confirmed settlements only", () => {
    const balances = calculateBalances(
      [{ id: "payer" }, { id: "one" }, { id: "two" }],
      [
        {
          paid_by_member_id: "payer",
          amount_minor: "9007199254741001",
          shares: [
            { trip_member_id: "one", owed_minor: "4503599627370501" },
            { trip_member_id: "two", owed_minor: "4503599627370500" },
          ],
        },
      ],
      [
        {
          from_member_id: "one",
          to_member_id: "payer",
          amount_minor: "500",
          status: "pending",
        },
      ],
    );
    expect(balances.get("payer")).toBe(9007199254741001n);
    expect(balances.get("one")).toBe(-4503599627370501n);
    expect(suggestSettlements(balances)).toEqual([
      { from: "one", to: "payer", amountMinor: 4503599627370501n },
      { from: "two", to: "payer", amountMinor: 4503599627370500n },
    ]);
  });

  it("applies confirmed repayment against both parties exactly", () => {
    const balances = calculateBalances(
      [{ id: "a" }, { id: "b" }],
      [
        {
          paid_by_member_id: "a",
          amount_minor: "100",
          shares: [{ trip_member_id: "b", owed_minor: "100" }],
        },
      ],
      [
        {
          from_member_id: "b",
          to_member_id: "a",
          amount_minor: "40",
          status: "confirmed",
        },
      ],
    );
    expect(balances.get("a")).toBe(60n);
    expect(balances.get("b")).toBe(-60n);
  });
});
