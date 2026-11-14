import { QueryClient, QueryClientProvider } from "@tanstack/preact-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  stays: [
    {
      id: "stay-1",
      trip_id: "trip-1",
      check_in_date: "2026-11-01",
      check_out_date: "2026-11-03",
      name: "Old hotel",
      address: "Old address",
      phone: "555-0100",
      version: 7,
    },
  ],
  activities: [
    {
      id: "activity-1",
      trip_id: "trip-1",
      title: "Temple visit",
      starts_at: "2026-11-02T02:30:00.000Z",
      plan_date: "2026-11-02",
      address: null,
      meeting_info: null,
      notes: null,
      transport_mode: null,
      position: 0,
      version: 4,
    },
  ],
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      not: () => query,
      order: () => query,
      then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({
          data:
            table === "stays"
              ? fixtures.stays
              : table === "itinerary_items"
                ? fixtures.activities
                : [],
          error: null,
        }).then(resolve),
    };
    return query;
  }),
}));
vi.mock("../src/shared/supabase/client", () => ({
  supabase: { from: fixtures.from, rpc: fixtures.rpc },
}));
vi.mock("../src/features/offline/db", () => ({
  cacheTripData: vi.fn(),
  readCachedTripData: vi.fn(),
}));

import { Plan } from "../src/features/plan/Plan";
import { tripWallTimeToIso } from "../src/features/plan/timezone";

const trip = {
  id: "trip-1",
  title: "Bangkok",
  base_currency: "THB",
  timezone: "Asia/Bangkok",
  start_date: "2026-11-01",
  end_date: "2026-11-04",
  status: "active",
};

function renderPlan(organizer = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Plan trip={trip} uid="user-1" thai={false} organizer={organizer} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fixtures.rpc.mockReset().mockResolvedValue({ error: null });
  fixtures.from.mockClear();
});

describe("Plan editors", () => {
  it("opens record actions with keyboard and restores focus on Escape", async () => {
    renderPlan();
    const trigger = await screen.findByRole("button", {
      name: "Options for Temple visit",
    });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const edit = await screen.findByRole("menuitem", { name: "Edit activity" });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Remove" }),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps organizer edit actions hidden from guests", () => {
    renderPlan(false);
    expect(screen.queryByRole("button", { name: "Edit itinerary" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Options for Temple visit" }),
    ).toBeNull();
  });

  it("reveals add forms and repeats editor navigation after closing", async () => {
    renderPlan();

    const fab = screen.getByRole("button", { name: "Edit itinerary" });
    const openAction = (name: string) => {
      fireEvent.click(fab);
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    openAction("Add city for a night or range");
    const nightEditor = await screen.findByRole("heading", {
      name: "Add destination for a night or range",
    });
    expect(document.activeElement).toBe(nightEditor.parentElement);
    document.body.focus();
    openAction("Add city for a night or range");
    expect(document.activeElement).toBe(nightEditor.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    openAction("Add activity");
    await screen.findByRole("heading", { name: "Add activity" });
    const activityForm = screen.getByLabelText("Activity").closest("form");
    expect(document.activeElement).toBe(activityForm);
    document.body.focus();
    openAction("Add activity");
    expect(document.activeElement).toBe(activityForm);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openAction("Add activity");
    expect(
      await screen.findByRole("heading", { name: "Add activity" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Accommodation" }));
    openAction("Add accommodation");
    const stayEditor = await screen.findByRole("heading", {
      name: "Add accommodation",
    });
    expect(document.activeElement).toBe(stayEditor.parentElement);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openAction("Add accommodation");
    expect(
      await screen.findByRole("heading", { name: "Add accommodation" }),
    ).toBeTruthy();
  });

  it("opens a prefilled accommodation editor from its closed state", async () => {
    renderPlan();
    await screen.findAllByText("Old hotel");

    fireEvent.click(
      screen.getAllByRole("button", { name: "Options for Old hotel" })[0],
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Edit accommodation" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Edit accommodation" }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("Old hotel")).toBeTruthy();
    const editor = screen.getByRole("heading", { name: "Edit accommodation" })
      .parentElement as HTMLFormElement;
    expect(editor).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(editor);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New hotel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save accommodation" }));
    await waitFor(() =>
      expect(fixtures.rpc).toHaveBeenCalledWith(
        "upsert_stay",
        expect.objectContaining({
          p_stay_id: "stay-1",
          p_expected_version: 7,
          p_name: "New hotel",
        }),
      ),
    );
  });

  it("shows a stay on every covered day and excludes the check-out day", async () => {
    renderPlan();
    await screen.findAllByText("Old hotel");
    const days = await screen.findAllByRole("article");
    const coveredDay = days.find((day) => day.textContent?.includes("Day 2"));
    const checkoutDay = days.find((day) => day.textContent?.includes("Day 3"));
    expect(coveredDay?.textContent).toContain("Old hotel");
    expect(checkoutDay?.textContent).not.toContain("Old hotel");
    fireEvent.click(screen.getByRole("button", { name: "Accommodation" }));
    expect(screen.getByText("Old hotel")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Old hotel" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Edit accommodation" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Edit accommodation" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Check-in")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Check-out (exclusive)")).toHaveValue(
      "2026-11-03",
    );
  });

  it("edits and saves activity time in the destination timezone", async () => {
    renderPlan();
    await screen.findByText("Temple visit");
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Temple visit" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit activity" }));

    expect(await screen.findByDisplayValue("09:30")).toBeTruthy();
    expect(screen.getByLabelText("Day")).toHaveValue("2026-11-02");
    const editor = screen
      .getByLabelText("Activity")
      .closest("form") as HTMLFormElement;
    expect(document.activeElement).toBe(editor);
    fireEvent.change(screen.getByLabelText("Destination time"), {
      target: { value: "10:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));

    await waitFor(() =>
      expect(fixtures.rpc).toHaveBeenCalledWith(
        "upsert_itinerary_item",
        expect.objectContaining({
          p_item_id: "activity-1",
          p_expected_version: 4,
          p_starts_at: tripWallTimeToIso("2026-11-02T10:15", "Asia/Bangkok"),
          p_plan_date: "2026-11-02",
        }),
      ),
    );
  });

  it("keeps a new activity draft when its local day changes", async () => {
    renderPlan();
    fireEvent.click(screen.getByRole("button", { name: "Edit itinerary" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add activity" }));
    fireEvent.change(screen.getByLabelText("Activity"), {
      target: { value: "Draft title" },
    });
    const day = screen.getByLabelText("Day");
    day.focus();
    fireEvent.change(day, { target: { value: "2026-11-03" } });

    expect(screen.getByLabelText("Activity")).toHaveValue("Draft title");
    expect(day).toHaveValue("2026-11-03");
    expect(document.activeElement).toBe(day);
  });
});
