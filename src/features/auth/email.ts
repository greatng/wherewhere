import type { User } from "@supabase/supabase-js";
import { supabase } from "../../shared/supabase/client";

export type EmailEnrollment = {
  email: string;
  type: "email" | "email_change" | "signup";
  guestId?: string;
};
export function canCreateTrip(
  user:
    | Pick<User, "email" | "email_confirmed_at" | "is_anonymous">
    | null
    | undefined,
) {
  return !!user?.email && !!user.email_confirmed_at && !user.is_anonymous;
}

export async function requestEmailCode(
  email: string,
): Promise<EmailEnrollment> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error("invalid_email");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.is_anonymous) {
    // Link email to this guest rather than creating a replacement identity.
    const result = await supabase.auth.updateUser({ email: normalized });
    if (result.error) throw result.error;
    return {
      email: normalized,
      type: "email_change",
      guestId: data.session.user.id,
    };
  }
  if (data.session) {
    if (canCreateTrip(data.session.user)) throw new Error("already_signed_in");
    if (data.session.user.email?.toLowerCase() !== normalized)
      throw new Error("session_email_mismatch");
    const result = await supabase.auth.resend({
      type: "signup",
      email: normalized,
    });
    if (result.error) throw result.error;
    return { email: normalized, type: "signup", guestId: data.session.user.id };
  }
  const result = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true },
  });
  if (result.error) throw result.error;
  return { email: normalized, type: "email" };
}

export async function confirmEmailCode(
  enrollment: EmailEnrollment,
  token: string,
) {
  if (!/^\d{6}$/.test(token)) throw new Error("invalid_code");
  if (enrollment.guestId) {
    const current = await supabase.auth.getSession();
    if (current.error) throw current.error;
    if (current.data.session?.user.id !== enrollment.guestId)
      throw new Error("session_changed");
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email: enrollment.email,
    token,
    type: enrollment.type,
  });
  if (error) throw error;
  if (enrollment.guestId && data.user?.id !== enrollment.guestId)
    throw new Error("session_changed");
  if (!canCreateTrip(data.user)) throw new Error("verification_incomplete");
  return data.user;
}
