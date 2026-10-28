import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheTripData,
  clearAllLocalData,
  clearTripData,
  localDb,
  pendingOperations,
  queueOperation,
  readCachedTripData,
} from "../src/features/offline/db";

afterEach(async () => {
  await clearAllLocalData();
});

describe("offline cache and outbox", () => {
  it("isolates cached trip data by local identity", async () => {
    await cacheTripData("user-a", "trip-1", "itinerary", [
      { title: "Station" },
    ]);
    await cacheTripData("user-b", "trip-1", "itinerary", [
      { title: "Private" },
    ]);
    expect(await readCachedTripData("user-a", "trip-1", "itinerary")).toEqual([
      { title: "Station" },
    ]);
    expect(await readCachedTripData("user-b", "trip-1", "itinerary")).toEqual([
      { title: "Private" },
    ]);
  });

  it("persists one idempotent operation and replays sending state after restart", async () => {
    const operation = {
      id: "operation-1",
      ownerId: "user-a",
      tripId: "trip-1",
      kind: "expense" as const,
      payload: { p_operation_id: "operation-1", p_amount_minor: "2000" },
    };
    await queueOperation(operation);
    await queueOperation(operation);
    await localDb.outbox.update(operation.id, { state: "sending" });
    const afterRestart = await pendingOperations("user-a", "trip-1");
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0].payload.p_amount_minor).toBe("2000");
    await localDb.outbox.update(operation.id, { state: "pending" });
    expect((await pendingOperations("user-a", "trip-1"))[0].state).toBe(
      "pending",
    );
  });

  it("removes only the removed trip's data for that identity", async () => {
    await cacheTripData("user-a", "trip-1", "emergency", {
      hotel_phone: "555",
    });
    await cacheTripData("user-a", "trip-2", "itinerary", []);
    await queueOperation({
      id: "operation-1",
      ownerId: "user-a",
      tripId: "trip-1",
      kind: "check_in",
      payload: {},
    });
    await queueOperation({
      id: "operation-2",
      ownerId: "user-b",
      tripId: "trip-1",
      kind: "check_in",
      payload: {},
    });
    await clearTripData("trip-1", "user-a");
    expect(
      await readCachedTripData("user-a", "trip-1", "emergency"),
    ).toBeUndefined();
    expect(await pendingOperations("user-a", "trip-1")).toHaveLength(0);
    expect(await pendingOperations("user-b", "trip-1")).toHaveLength(1);
    expect(await readCachedTripData("user-a", "trip-2", "itinerary")).toEqual(
      [],
    );
  });
});
