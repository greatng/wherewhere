import Dexie, { type Table } from "dexie";

export type CachedTripData = {
  ownerId: string;
  tripId: string;
  kind:
    | "itinerary"
    | "members"
    | "expenses"
    | "emergency"
    | "trips"
    | "checkins"
    | "settlements"
    | "balances"
    | "nightly_plan"
    | "stays"
    | "plan_activities";
  payload: unknown;
  savedAt: number;
};
export type PendingOperation = {
  ownerId: string;
  id: string;
  tripId: string;
  kind: "check_in" | "expense";
  payload: Record<string, unknown>;
  createdAt: number;
  state: "pending" | "sending" | "failed" | "blocked";
  error?: string;
};

class TravelMateDB extends Dexie {
  cached!: Table<CachedTripData, [string, string, string]>;
  outbox!: Table<PendingOperation, string>;
  constructor() {
    super("travelmate");
    this.version(1).stores({
      cached: "[ownerId+tripId+kind], ownerId, tripId, savedAt",
      outbox: "id, [ownerId+tripId], ownerId, tripId, kind, createdAt, state",
    });
  }
}

export const localDb = new TravelMateDB();

// The app marks sign-out before clearing IndexedDB. Late fetches must not
// repopulate private data after cleanup or under a replacement identity.
function mayWriteCache(ownerId: string): boolean {
  if (typeof localStorage === "undefined") return true;
  if (localStorage.getItem("paikan-cache-disabled") === "true") return false;
  const current = localStorage.getItem("travelmate-local-user");
  return !current || current === ownerId;
}

export async function cacheTripData(
  ownerId: string,
  tripId: string,
  kind: CachedTripData["kind"],
  payload: unknown,
) {
  if (!mayWriteCache(ownerId)) return;
  await localDb.transaction("rw", localDb.cached, async () => {
    if (!mayWriteCache(ownerId)) return;
    await localDb.cached.put({
      ownerId,
      tripId,
      kind,
      payload,
      savedAt: Date.now(),
    });
    if (!mayWriteCache(ownerId))
      await localDb.cached.delete([ownerId, tripId, kind]);
  });
}

export async function readCachedTripData<T>(
  ownerId: string,
  tripId: string,
  kind: CachedTripData["kind"],
): Promise<T | undefined> {
  return (await localDb.cached.get([ownerId, tripId, kind]))?.payload as
    T | undefined;
}

export async function queueOperation(
  operation: Omit<PendingOperation, "createdAt" | "state">,
) {
  await localDb.outbox.put({
    ...operation,
    createdAt: Date.now(),
    state: "pending",
  });
}

export async function pendingOperations(ownerId: string, tripId: string) {
  return localDb.outbox
    .where("[ownerId+tripId]")
    .equals([ownerId, tripId])
    .sortBy("createdAt");
}

export async function clearTripData(tripId: string, ownerId?: string) {
  await localDb.transaction("rw", localDb.cached, localDb.outbox, async () => {
    const cached = localDb.cached.where("tripId").equals(tripId);
    const outbox = localDb.outbox.where("tripId").equals(tripId);
    if (ownerId) {
      await cached.and((row) => row.ownerId === ownerId).delete();
      await outbox.and((row) => row.ownerId === ownerId).delete();
    } else {
      await cached.delete();
      await outbox.delete();
    }
  });
}

export async function clearAllLocalData() {
  await localDb.transaction("rw", localDb.cached, localDb.outbox, async () => {
    await localDb.cached.clear();
    await localDb.outbox.clear();
  });
}
