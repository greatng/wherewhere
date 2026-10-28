import { test, expect, vi, beforeEach } from "vitest";
const invoke = vi.fn(),
  getSession = vi.fn(),
  signInAnonymously = vi.fn();
vi.mock("../src/shared/supabase/client", () => ({
  supabase: { functions: { invoke }, auth: { getSession, signInAnonymously } },
}));
beforeEach(() => vi.resetAllMocks());
test("invalid invitations never create identities", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({ data: { session: null } });
  invoke.mockResolvedValue({ error: true });
  await expect(redeem("bad", "Name")).rejects.toThrow();
  expect(signInAnonymously).not.toHaveBeenCalled();
});
test("existing persistent identity is reused", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  invoke.mockResolvedValue({ data: {} });
  getSession.mockResolvedValue({
    data: { session: { access_token: "existing" } },
  });
  await redeem("token", "Name");
  expect(signInAnonymously).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenLastCalledWith(
    "invite-gateway",
    expect.objectContaining({ headers: { Authorization: "Bearer existing" } }),
  );
});
test("valid invitation creates one new identity only after validation", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  invoke.mockResolvedValue({ data: {} });
  getSession.mockResolvedValue({ data: { session: null } });
  signInAnonymously.mockResolvedValue({
    data: { session: { access_token: "new" } },
  });
  await redeem("token", "Name");
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
  expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(
    signInAnonymously.mock.invocationCallOrder[0],
  );
});
