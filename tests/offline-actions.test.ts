import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimOperation,
  discardOperation,
  retryOperation,
} from "../src/features/offline/actions";
import {
  clearAllLocalData,
  localDb,
  queueOperation,
} from "../src/features/offline/db";

afterEach(async () => clearAllLocalData());

const add = (id: string) =>
  queueOperation({
    id,
    ownerId: "u",
    tripId: "t",
    kind: "check_in",
    payload: { p_operation_id: id },
  });

describe("offline queue actions", () => {
  it("retries a failed operation under the same UUID and refuses another identity", async () => {
    await add("same-id");
    await localDb.outbox.update("same-id", {
      state: "failed",
      error: "timeout",
    });
    expect(await retryOperation("same-id", "other", "t")).toBe(false);
    expect(await retryOperation("same-id", "u", "t")).toBe(true);
    expect(await localDb.outbox.get("same-id")).toMatchObject({
      id: "same-id",
      state: "pending",
      payload: { p_operation_id: "same-id" },
    });
  });

  it("requires confirmation to discard and protects sending operations", async () => {
    await add("sending");
    await localDb.outbox.update("sending", { state: "sending" });
    expect(await discardOperation("sending", "u", "t", () => true)).toBe(false);
    await add("failed");
    expect(await discardOperation("failed", "u", "t", () => false)).toBe(false);
    expect(await discardOperation("failed", "u", "t", () => true)).toBe(true);
  });

  it("atomically claims only a surviving operation before sending and reclaims crash-left sending state", async () => {
    expect(await claimOperation("discarded", "u", "t")).toBe(false);
    await add("replay");
    await localDb.outbox.update("replay", { state: "sending" });
    expect(await claimOperation("replay", "u", "t")).toBe(true);
    expect(await claimOperation("replay", "other", "t")).toBe(false);
  });
});
