import { localDb, pendingOperations, type PendingOperation } from "./db";

export async function retryOperation(
  id: string,
  ownerId: string,
  tripId: string,
) {
  return localDb.transaction("rw", localDb.outbox, async () => {
    const operation = await localDb.outbox.get(id);
    if (
      !operation ||
      operation.ownerId !== ownerId ||
      operation.tripId !== tripId ||
      operation.state === "sending"
    )
      return false;
    await localDb.outbox.update(id, { state: "pending", error: undefined });
    return true;
  });
}

/** Atomically claims an existing operation before its RPC starts. A discard that wins first prevents the send. */
export async function claimOperation(
  id: string,
  ownerId: string,
  tripId: string,
) {
  return localDb.transaction("rw", localDb.outbox, async () => {
    const operation = await localDb.outbox.get(id);
    if (
      !operation ||
      operation.ownerId !== ownerId ||
      operation.tripId !== tripId ||
      operation.state === "blocked"
    )
      return false;
    await localDb.outbox.update(id, { state: "sending", error: undefined });
    return true;
  });
}

export async function discardOperation(
  id: string,
  ownerId: string,
  tripId: string,
  confirmDiscard: () => boolean,
) {
  if (!confirmDiscard()) return false;
  return localDb.transaction("rw", localDb.outbox, async () => {
    const operation = await localDb.outbox.get(id);
    if (
      !operation ||
      operation.ownerId !== ownerId ||
      operation.tripId !== tripId ||
      operation.state === "sending"
    )
      return false;
    await localDb.outbox.delete(id);
    return true;
  });
}

export function queuedOperationCount(operations: PendingOperation[]) {
  return operations.filter(
    (operation) =>
      operation.state === "pending" ||
      operation.state === "sending" ||
      operation.state === "failed",
  ).length;
}

export { pendingOperations };
