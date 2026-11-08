import { describe, expect, it } from "vitest";
import { actionError } from "../src/features/trips/errors";
describe("action recovery guidance", () => {
  it("distinguishes missing setup, conflicts, permissions, and expired session", () => {
    expect(actionError({ code: "PGRST202" })).toContain("migrations");
    expect(actionError({ code: "40001" })).toContain("another device");
    expect(actionError({ code: "42501" })).toContain("permission");
    expect(actionError({ status: 401 })).toContain("Guests should contact");
  });
  it("does not expose technical payloads or invite tokens in errors", () => {
    expect(actionError({ message: "secret raw token payload" })).not.toContain(
      "secret",
    );
    expect(actionError({ code: "PGRST202" }, true)).toContain("ฐานข้อมูล");
  });
});
