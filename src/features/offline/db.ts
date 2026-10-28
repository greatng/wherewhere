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
    | "balances";
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

export async function cacheTripData(
  ownerId: string,
  tripId: string,
  kind: CachedTripData["kind"],
  payload: unknown,
) {
  await localDb.cached.put({
    ownerId,
    tripId,
    kind,
    payload,
    savedAt: Date.now(),
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
