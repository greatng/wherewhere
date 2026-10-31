import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
}));
vi.mock("../src/shared/supabase/client", () => ({ supabase: { auth } }));
import {
  canCreateTrip,
  confirmEmailCode,
  requestEmailCode,
} from "../src/features/auth/email";
import { EmailAccess } from "../src/features/auth/EmailAccess";

beforeEach(() => {
  vi.resetAllMocks();
});

test("only confirmed email identities can create trips", () => {
  expect(canCreateTrip(null)).toBe(false);
  expect(
    canCreateTrip({
      email: "person@example.com",
      is_anonymous: true,
      email_confirmed_at: "2026-01-01",
    }),
  ).toBe(false);
  expect(
    canCreateTrip({ email: "person@example.com", is_anonymous: false }),
  ).toBe(false);
  expect(
    canCreateTrip({
      email: "person@example.com",
      is_anonymous: false,
      email_confirmed_at: "2026-01-01",
    }),
  ).toBe(true);
});

test("signed-out email enrollment requests an OTP without anonymous signup", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  expect(await requestEmailCode(" Person@example.com ")).toEqual({
    email: "person@example.com",
    type: "email",
  });
  expect(auth.signInWithOtp).toHaveBeenCalledWith({
    email: "person@example.com",
    options: { shouldCreateUser: true },
  });
  expect(auth.updateUser).not.toHaveBeenCalled();
});

test("guest email enrollment links and verifies the original guest identity", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "guest-1", is_anonymous: true } } },
  });
  auth.updateUser.mockResolvedValue({ error: null });
  const pending = await requestEmailCode("person@example.com");
  expect(pending).toEqual({
    email: "person@example.com",
    type: "email_change",
    guestId: "guest-1",
  });
  expect(auth.updateUser).toHaveBeenCalledWith({ email: "person@example.com" });
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  auth.verifyOtp.mockResolvedValue({
    data: {
      user: {
        id: "guest-1",
        email: "person@example.com",
        email_confirmed_at: "2026-01-01",
        is_anonymous: false,
      },
    },
  });
  await confirmEmailCode(pending, "012345");
  expect(auth.verifyOtp).toHaveBeenCalledWith({
    email: "person@example.com",
    token: "012345",
    type: "email_change",
  });
});

test("guest enrollment never verifies after switching identity", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "different" } } },
  });
  await expect(
    confirmEmailCode(
      {
        email: "person@example.com",
        type: "email_change",
        guestId: "original",
      },
      "123456",
    ),
  ).rejects.toThrow("session_changed");
  expect(auth.verifyOtp).not.toHaveBeenCalled();
});

test("invalid code and failed verification cannot unlock trip creation", async () => {
  await expect(
    confirmEmailCode({ email: "person@example.com", type: "email" }, "12345"),
  ).rejects.toThrow("invalid_code");
  expect(auth.verifyOtp).not.toHaveBeenCalled();
  auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });
  await expect(
    confirmEmailCode({ email: "person@example.com", type: "email" }, "123456"),
  ).rejects.toThrow("expired");
});

test("email UI is inert on launch, then offers code verification and resend cooldown", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  const verified = vi.fn();
  render(<EmailAccess guest={false} thai={false} onVerified={verified} />);
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  fireEvent.input(screen.getByLabelText("Email address"), {
    target: { value: "person@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await screen.findByLabelText("Six-digit code");
  expect(screen.getByRole("button", { name: /Resend in/ })).toBeDisabled();
  auth.verifyOtp.mockResolvedValue({
    data: {
      user: {
        id: "email-1",
        email: "person@example.com",
        email_confirmed_at: "2026-01-01",
        is_anonymous: false,
      },
    },
  });
  fireEvent.input(screen.getByLabelText("Six-digit code"), {
    target: { value: "012345" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(verified).toHaveBeenCalledOnce());
});

test("an unverified email session resends its own signup verification without replacing identity", async () => {
  auth.getSession.mockResolvedValue({
    data: {
      session: {
        user: {
          id: "email-1",
          email: "person@example.com",
          is_anonymous: false,
        },
      },
    },
  });
  auth.resend.mockResolvedValue({ error: null });
  expect(await requestEmailCode("person@example.com")).toEqual({
    email: "person@example.com",
    type: "signup",
    guestId: "email-1",
  });
  expect(auth.resend).toHaveBeenCalledWith({
    type: "signup",
    email: "person@example.com",
  });
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  await expect(requestEmailCode("someoneelse@example.com")).rejects.toThrow(
    "session_email_mismatch",
  );
});
