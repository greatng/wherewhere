export type ParticipantShare = { memberId: string; owedMinor: number };

/** Divide minor currency units equally; earlier members receive the remainder. */
export function splitAmount(
  amountMinor: number,
  memberIds: string[],
): ParticipantShare[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw new Error("Amount must be a positive whole number of minor units");
  if (!memberIds.length || new Set(memberIds).size !== memberIds.length)
    throw new Error("Choose at least one distinct participant");
  const base = Math.floor(amountMinor / memberIds.length);
  let remainder = amountMinor % memberIds.length;
  return memberIds.map((memberId) => ({
    memberId,
    owedMinor: base + (remainder-- > 0 ? 1 : 0),
  }));
}

export function calculateBalances(
  members: { id: string }[],
  expenses: {
    paid_by_member_id: string;
    amount_minor: number | string;
    shares?: { trip_member_id: string; owed_minor: number | string }[];
  }[],
  settlements: {
    from_member_id: string;
    to_member_id: string;
    amount_minor: number | string;
    status: string;
  }[] = [],
) {
  const balances = new Map(members.map(({ id }) => [id, 0n]));
  for (const expense of expenses) {
    balances.set(
      expense.paid_by_member_id,
      (balances.get(expense.paid_by_member_id) ?? 0n) +
        BigInt(expense.amount_minor),
    );
    for (const share of expense.shares ?? [])
      balances.set(
        share.trip_member_id,
        (balances.get(share.trip_member_id) ?? 0n) - BigInt(share.owed_minor),
      );
  }
  for (const settlement of settlements.filter(
    (item) => item.status === "confirmed",
  )) {
    const amount = BigInt(settlement.amount_minor);
    balances.set(
      settlement.from_member_id,
      (balances.get(settlement.from_member_id) ?? 0n) + amount,
    );
    balances.set(
      settlement.to_member_id,
      (balances.get(settlement.to_member_id) ?? 0n) - amount,
    );
  }
  return balances;
}

/** Greedy deterministic settlement plan from net member balances. */
export function suggestSettlements(balances: Map<string, bigint>) {
  const creditors = [...balances]
    .filter(([, value]) => value > 0n)
    .sort(([a], [b]) => a.localeCompare(b));
  const debtors = [...balances]
    .filter(([, value]) => value < 0n)
    .map(([id, value]) => [id, -value] as [string, bigint])
    .sort(([a], [b]) => a.localeCompare(b));
  const result: { from: string; to: string; amountMinor: bigint }[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amountMinor =
      debtors[i][1] < creditors[j][1] ? debtors[i][1] : creditors[j][1];
    result.push({ from: debtors[i][0], to: creditors[j][0], amountMinor });
    debtors[i][1] -= amountMinor;
    creditors[j][1] -= amountMinor;
    if (!debtors[i][1]) i++;
    if (!creditors[j][1]) j++;
  }
  return result;
}
