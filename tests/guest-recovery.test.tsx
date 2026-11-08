import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { GuestRecovery } from "../src/features/trips/GuestRecovery";
const requests = [
  {
    id: "denied",
    trip_id: "trip",
    status: "denied",
    requested_display_name: "Mali",
  },
  {
    id: "pending",
    trip_id: "trip",
    status: "pending",
    requested_display_name: "Mali new device",
  },
  {
    id: "foreign",
    trip_id: "other",
    status: "pending",
    requested_display_name: "Other trip",
  },
];
const members = [
  {
    id: "old",
    trip_id: "trip",
    status: "removed",
    display_name: "Mali old device",
    role: "member",
  },
];
describe("organizer supervised recovery controls", () => {
  it("sends verified selection and never offers foreign trip requests", () => {
    const onAction = vi.fn();
    render(
      <GuestRecovery
        tripId="trip"
        requests={requests}
        members={members}
        invites={[]}
        busy={false}
        thai={false}
        onAction={onAction}
      />,
    );
    expect(screen.queryByText("Other trip")).toBeNull();
    fireEvent.click(
      screen.getByText("Reconnect a verified traveler to an existing member"),
    );
    fireEvent.change(screen.getByLabelText("Requesting device"), {
      target: { value: "pending" },
    });
    fireEvent.change(screen.getByLabelText("Existing removed member"), {
      target: { value: "old" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "I verified these are the same person and authorize moving access.",
      ),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Recover existing member" })
        .closest("form")!,
    );
    expect(onAction).toHaveBeenCalledWith("recover_member", {
      p_member_id: "old",
      p_request_id: "pending",
      p_identity_verified: true,
    });
  });
  it("reopen sends replacement invite only after organizer verification", () => {
    const onAction = vi.fn();
    render(
      <GuestRecovery
        tripId="trip"
        requests={requests}
        members={[]}
        invites={[
          {
            id: "fresh",
            trip_id: "trip",
            revoked_at: null,
            expires_at: "2099-01-01T00:00:00Z",
            uses_count: 0,
            max_uses: 8,
          },
        ]}
        busy={false}
        thai={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText("Reopen request for Mali"));
    fireEvent.change(screen.getByLabelText("Invitation for this request"), {
      target: { value: "fresh" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "I verified this person through a trusted channel.",
      ),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Reopen for approval" })
        .closest("form")!,
    );
    expect(onAction).toHaveBeenCalledWith("reopen_join_request", {
      p_request_id: "denied",
      p_identity_verified: true,
      p_invite_id: "fresh",
    });
  });
});
