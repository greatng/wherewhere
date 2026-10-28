import { expect, test } from "@playwright/test";

const uid = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const alice = "33333333-3333-4333-8333-333333333333";
const bob = "44444444-4444-4444-8444-444444444444";
const token = "fixture-access-token";
type FixtureRpcArgs = {
  p_trip_id: string;
  p_title?: string;
  p_starts_at?: string | null;
  p_address?: string | null;
  p_meeting_info?: string | null;
  p_notes?: string | null;
  p_transport_mode?: string | null;
  p_position?: number;
  p_payer_member_id?: string;
  p_amount_minor?: string;
  p_description?: string;
  p_shares?: { member_id: string; owed_minor: string }[];
  p_member_id?: string;
  p_item_id?: string;
};

async function installFixture(page: import("@playwright/test").Page) {
  const trip = {
    id: tripId,
    title: "Bangkok Weekend",
    start_date: "2026-11-01",
    end_date: "2026-11-04",
    base_currency: "THB",
    status: "active",
  };
  const members = [
    {
      id: alice,
      trip_id: tripId,
      user_id: uid,
      display_name: "Mali",
      role: "organizer",
      status: "approved",
    },
    {
      id: bob,
      trip_id: tripId,
      user_id: null,
      display_name: "Niran",
      role: "traveler",
      status: "approved",
    },
  ];
  let itinerary: Record<string, unknown>[] = [
    {
      id: "stop-1",
      trip_id: tripId,
      title: "Wat Arun",
      starts_at: "2026-11-01T09:00:00Z",
      address: "Bangkok, Thailand",
      latitude: 13.7437,
      longitude: 100.4889,
      meeting_info: "Meet at the river pier",
      notes: "Bring water",
      transport_mode: "boat",
      position: 0,
      version: 1,
    },
  ];
  let expenses: Record<string, unknown>[] = [
    {
      id: "expense-1",
      trip_id: tripId,
      paid_by_member_id: alice,
      amount_minor: 900,
      currency: "THB",
      description: "Airport taxi",
      created_at: "2026-10-27T10:00:00Z",
      expense_shares: [
        { trip_member_id: alice, owed_minor: 450 },
        { trip_member_id: bob, owed_minor: 450 },
      ],
    },
  ];
  let checkIns: Record<string, unknown>[] = [];
  let savedExpense: FixtureRpcArgs | undefined;
  let savedCheckIn: FixtureRpcArgs | undefined;

  await page.addInitScript(
    ({ uid, token }) => {
      const session = {
        access_token: token,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "fixture-refresh",
        user: {
          id: uid,
          aud: "authenticated",
          role: "authenticated",
          email: "fixture@example.test",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      };
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    },
    { uid, token },
  );

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop() ?? "";
    let data: unknown[] = [];
    if (table === "trips") data = [trip];
    if (table === "trip_members") data = members;
    if (table === "trip_join_requests" || table === "trip_invites") data = [];
    if (table === "itinerary_items") data = itinerary;
    if (table === "expenses") data = expenses;
    if (table === "check_ins") data = checkIns;
    const from = Number(route.request().headers()["range"]?.split("-")[0] ?? 0);
    const to = Number(
      route.request().headers()["range"]?.split("-")[1] ?? data.length - 1,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "content-range": `${from}-${Math.min(to, data.length - 1)}/${data.length}`,
      },
      body: JSON.stringify(data.slice(from, to + 1)),
    });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop();
    const args = route.request().postDataJSON() as FixtureRpcArgs;
    let result: unknown = null;
    if (fn === "upsert_itinerary_item") {
      const item = {
        id: "stop-added",
        trip_id: tripId,
        title: args.p_title,
        starts_at: args.p_starts_at,
        address: args.p_address,
        meeting_info: args.p_meeting_info,
        notes: args.p_notes,
        transport_mode: args.p_transport_mode,
        position: args.p_position,
        version: 1,
      };
      itinerary = [...itinerary, item];
      result = item;
    } else if (fn === "create_expense") {
      savedExpense = args;
      const exp = {
        id: "expense-added",
        trip_id: tripId,
        paid_by_member_id: args.p_payer_member_id,
        amount_minor: args.p_amount_minor,
        currency: "THB",
        description: args.p_description,
        created_at: new Date().toISOString(),
        expense_shares:
          args.p_shares?.map((share) => ({
            trip_member_id: share.member_id,
            owed_minor: share.owed_minor,
          })) ?? [],
      };
      expenses = [exp, ...expenses];
      result = exp;
    } else if (fn === "check_in") {
      savedCheckIn = args;
      checkIns = [
        ...checkIns,
        {
          id: "check-1",
          trip_id: tripId,
          trip_member_id: args.p_member_id,
          itinerary_item_id: args.p_item_id,
          checked_in_at: new Date().toISOString(),
        },
      ];
      result = checkIns[0];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return {
    getSavedExpense: () => savedExpense,
    getSavedCheckIn: () => savedCheckIn,
  };
}

test("mocked enrolled itinerary and expense flow; keyboard and labels; preview capture", async ({
  page,
}, testInfo) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bangkok Weekend" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wat Arun" })).toBeVisible();
  await expect(
    page.getByText("Niran — Not checked in", { exact: true }),
  ).toBeVisible();

  const destination = page.getByLabel("Place or activity");
  await expect(destination).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "TravelMate" })).toBeFocused();

  await destination.fill("Chatuchak Market");
  await page.getByLabel("Address").fill("Kamphaeng Phet 2 Road");
  await page.getByLabel("Notes").fill("Arrive before noon");
  await page.getByRole("button", { name: "Save stop" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Stop saved." }),
  ).toBeVisible();
  await expect(
    page.getByText("Chatuchak Market", { exact: true }),
  ).toBeVisible();
  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-itinerary-fixture-preview.png`,
  });

  await page.getByRole("button", { name: "Expenses" }).click();
  await page.getByLabel("What was it for?").fill("Street food");
  await page.getByLabel("Amount in minor units (THB satang)").fill("601");
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent and confirmed." }),
  ).toBeVisible();
  await expect
    .poll(() => fixtureState.getSavedExpense())
    .toMatchObject({
      p_amount_minor: "601",
      p_description: "Street food",
      p_payer_member_id: alice,
      p_shares: [
        { member_id: alice, owed_minor: "301" },
        { member_id: bob, owed_minor: "300" },
      ],
    });
  await expect(page.getByText("Airport taxi", { exact: true })).toBeVisible();

  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-expenses-fixture-preview.png`,
  });
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-fixture-preview.png`,
    fullPage: true,
  });
});

test("offline check-in stays queued until reconnect, then receives fixture acknowledgement", async ({
  page,
  context,
}) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bangkok Weekend" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wat Arun" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "I'm Here" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Saved locally. Waiting for server confirmation." }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "1 item(s) waiting to send" }),
  ).toBeVisible();
  await expect.poll(() => fixtureState.getSavedCheckIn()).toBeUndefined();

  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: "Sent and confirmed." }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "1 item(s) waiting to send" }),
  ).toHaveCount(0);
  await expect
    .poll(() => fixtureState.getSavedCheckIn())
    .toMatchObject({
      p_trip_id: tripId,
      p_member_id: alice,
      p_item_id: "stop-1",
    });
});
