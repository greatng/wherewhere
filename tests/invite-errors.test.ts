import { test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(),
  getSession = vi.fn(),
  signInAnonymously = vi.fn();
vi.mock("../src/shared/supabase/client", () => ({
  supabase: { functions: { invoke }, auth: { getSession, signInAnonymously } },
}));

beforeEach(() => vi.resetAllMocks());

function httpError(status: number, payload?: unknown) {
  return {
    name: "FunctionsHttpError",
    context: new Response(
      payload === undefined ? "not json" : JSON.stringify(payload),
      {
        status,
        headers: { "Content-Type": "application/json" },
      },
    ),
  };
}

test("gateway missing response gives organizer setup guidance", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({ data: { session: null } });
  invoke.mockResolvedValue({
    error: httpError(404, {
      code: "NOT_FOUND",
      message: "Requested function was not found",
    }),
  });
  const { actionError } = await import("../src/features/trips/errors");
  try {
    await redeem("secret-token", "Name");
  } catch (error) {
    expect(actionError(error)).toMatch(/invitations are not set up/i);
    expect(actionError(error, true)).toMatch(/คำเชิญ/);
    expect(String(error)).not.toContain("secret-token");
  }
  expect(signInAnonymously).not.toHaveBeenCalled();
});

test("invalid token does not create an anonymous identity", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({ data: { session: null } });
  invoke.mockResolvedValue({ data: { error: "invalid_invite" } });
  await expect(redeem("secret-token", "Name")).rejects.toThrow(
    /invitation.*valid/i,
  );
  expect(signInAnonymously).not.toHaveBeenCalled();
});

test("malformed gateway error produces safe actionable copy without token", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({ data: { session: null } });
  invoke.mockResolvedValue({ error: httpError(404) });
  const rejection = redeem("secret-token", "Name");
  await expect(rejection).rejects.toThrow(/invitations are not set up/i);
  await expect(rejection).rejects.not.toThrow("secret-token");
});

test("redeem 403 maps to a safe access message", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({
    data: { session: { access_token: "existing" } },
  });
  invoke.mockResolvedValue({ error: httpError(403, { code: "rate_limit" }) });
  await expect(redeem("secret-token", "Name")).rejects.toThrow(
    /too many|try again/i,
  );
});

test("disabled anonymous auth gives organizer setup guidance", async () => {
  const { redeem } = await import("../src/features/invites/redeem");
  getSession.mockResolvedValue({ data: { session: null } });
  invoke.mockResolvedValue({ data: { valid: true } });
  signInAnonymously.mockResolvedValue({
    error: { code: "anonymous_provider_disabled" },
  });
  await expect(redeem("secret-token", "Name")).rejects.toThrow(
    /enable anonymous sign-ins/i,
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("missing gateway secrets surface configuration guidance through App errors", async () => {
  const { inviteError } = await import("../src/features/invites/errors");
  const { actionError } = await import("../src/features/trips/errors");
  const error = await inviteError(
    httpError(503, {
      error: "gateway_not_configured",
      missing: ["APP_ORIGIN", "INVITE_RATE_LIMIT_SECRET"],
    }),
  );
  expect(actionError(error)).toMatch(/configure.*invitation service/i);
});
