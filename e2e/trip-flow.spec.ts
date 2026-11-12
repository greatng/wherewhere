import { expect, test } from "@playwright/test";

const uid = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const alice = "33333333-3333-4333-8333-333333333333";
const bob = "44444444-4444-4444-8444-444444444444";
const token = "fixture-access-token";
type FixtureRpcArgs = {
  [key: string]: unknown;
  p_trip_id: string;
  p_title?: string;
  p_starts_at?: string | null;
  p_address?: string | null;
  p_meeting_info?: string | null;
  p_notes?: string | null;
  p_transport_mode?: string | null;
  p_position?: number;
  p_plan_date?: string | null;
  p_start_date?: string;
  p_end_date?: string;
  p_city?: string;
  p_replace?: boolean;
  p_expected_versions?: Record<string, number>;
  p_check_in_date?: string;
  p_check_out_date?: string;
  p_name?: string;
  p_phone?: string | null;
  p_stay_id?: string | null;
  p_expected_version?: number | null;
  p_payer_member_id?: string;
  p_amount_minor?: string;
  p_currency?: string;
  p_operation_id?: string;
  p_description?: string;
  p_expense_id?: string;
  p_expense_date?: string | null;
  p_expense_time?: string | null;
  p_shares?: { member_id: string; owed_minor: string }[];
  p_member_id?: string;
  p_item_id?: string;
};

async function installFixture(
  page: import("@playwright/test").Page,
  options: { guest?: boolean } = {},
) {
  const trip = {
    id: tripId,
    title: "Bangkok Weekend",
    start_date: "2026-11-01",
    end_date: "2026-11-04",
    timezone: "Asia/Bangkok",
    base_currency: "THB",
    status: "active",
  };
  const emergencyCards = [
    {
      trip_id: tripId,
      hotel_name: "River House",
      hotel_address: "1 River Road",
      hotel_phone: "+66 2 123 4567",
      emergency_contact_name: "Somchai",
      emergency_contact_phone: "+66 81 234 5678",
    },
  ];
  const trips = [trip];
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
      role: "member",
      status: "approved",
    },
  ];
  let itinerary: Record<string, unknown>[] = [
    {
      id: "stop-1",
      trip_id: tripId,
      title: "Wat Arun",
      starts_at: "2026-11-02T02:00:00Z",
      address: "Bangkok, Thailand",
      latitude: 13.7437,
      longitude: 100.4889,
      meeting_info: "Meet at the river pier",
      notes: "Bring water",
      transport_mode: "boat",
      position: 0,
      version: 1,
      plan_date: "2026-11-02",
    },
    {
      id: "stop-past",
      trip_id: tripId,
      title: "Old Town Walk",
      starts_at: "2026-11-01T04:00:00Z",
      address: "Bangkok, Thailand",
      position: 1,
      version: 1,
      plan_date: "2026-11-01",
    },
    {
      id: "stop-next",
      trip_id: tripId,
      title: "Chatuchak Market",
      starts_at: "2026-11-02T05:00:00Z",
      address: "Kamphaeng Phet 2 Road",
      position: 2,
      version: 1,
      plan_date: "2026-11-02",
    },
  ];
  let nights: Record<string, unknown>[] = [
    {
      trip_id: tripId,
      night_date: "2026-11-01",
      city: "Bangkok",
      transport_mode: "boat",
      version: 1,
    },
    {
      trip_id: tripId,
      night_date: "2026-11-02",
      city: "Bangkok",
      transport_mode: "boat",
      version: 1,
    },
  ];
  let stays: Record<string, unknown>[] = [
    {
      id: "stay-1",
      trip_id: tripId,
      check_in_date: "2026-11-01",
      check_out_date: "2026-11-03",
      name: "River House",
      address: "1 River Road",
      phone: "+66 2 123 4567",
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
      expense_date: null,
      expense_time: null,
      version: 1,
      expense_shares: [
        { trip_member_id: alice, owed_minor: 450 },
        { trip_member_id: bob, owed_minor: 450 },
      ],
    },
  ];
  let checkIns: Record<string, unknown>[] = [];
  let savedExpense: FixtureRpcArgs | undefined;
  let savedCheckIn: FixtureRpcArgs | undefined;
  let failCheckInOnce = false;
  let savedCorrection: FixtureRpcArgs | undefined;
  const rpcCalls: { fn: string; args: FixtureRpcArgs }[] = [];

  await page.addInitScript(
    ({ uid, token, guest }) => {
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
          email: guest ? undefined : "fixture@example.test",
          email_confirmed_at: guest ? undefined : "2026-01-01T00:00:00Z",
          is_anonymous: guest,
          app_metadata: guest
            ? { provider: "anonymous", providers: ["anonymous"] }
            : { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      };
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    },
    { uid, token, guest: !!options.guest },
  );

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop() ?? "";
    let data: unknown[] = [];
    if (table === "trips") data = trips;
    if (table === "trip_members") data = members;
    if (table === "trip_join_requests" || table === "trip_invites") data = [];
    if (table === "itinerary_items") data = itinerary;
    if (table === "nightly_destinations") data = nights;
    if (table === "stays") data = stays;
    if (table === "expenses") data = expenses;
    if (table === "check_ins") data = checkIns;
    if (table === "emergency_cards") data = emergencyCards;
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

  await page.route("**/auth/v1/logout**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop();
    const args = route.request().postDataJSON() as FixtureRpcArgs;
    rpcCalls.push({ fn: fn ?? "", args });
    if (fn === "check_in" && failCheckInOnce) {
      failCheckInOnce = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "temporary server error" }),
      });
      return;
    }
    let result: unknown = null;
    if (fn === "upsert_itinerary_item") {
      const prior = args.p_item_id
        ? itinerary.find((candidate) => candidate.id === args.p_item_id)
        : undefined;
      const item = {
        ...prior,
        id: prior?.id ?? "stop-added",
        trip_id: tripId,
        title: args.p_title,
        starts_at: args.p_starts_at,
        address: args.p_address,
        meeting_info: args.p_meeting_info,
        notes: args.p_notes,
        transport_mode: args.p_transport_mode,
        position: args.p_position,
        version: Number(prior?.version ?? 0) + 1,
        plan_date: args.p_plan_date ?? null,
      };
      itinerary = prior
        ? itinerary.map((candidate) =>
            candidate.id === prior.id ? item : candidate,
          )
        : [...itinerary, item];
      result = item;
    } else if (fn === "set_nightly_destinations") {
      const from = String(args.p_start_date);
      const to = String(args.p_end_date);
      const dates: string[] = [];
      for (
        let d = new Date(`${from}T00:00:00Z`);
        d <= new Date(`${to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      )
        dates.push(d.toISOString().slice(0, 10));
      if (args.p_replace === true)
        nights = nights.filter((n) => !dates.includes(String(n.night_date)));
      nights = [
        ...nights,
        ...dates.map((night_date) => ({
          trip_id: tripId,
          night_date,
          city: args.p_city,
          transport_mode: args.p_transport_mode,
          version: 1,
        })),
      ];
      result = nights.filter((n) => dates.includes(String(n.night_date)));
    } else if (fn === "upsert_stay") {
      const prior = args.p_stay_id
        ? stays.find((candidate) => candidate.id === args.p_stay_id)
        : undefined;
      const stay = {
        ...prior,
        id: prior?.id ?? "stay-added",
        trip_id: tripId,
        check_in_date: args.p_check_in_date,
        check_out_date: args.p_check_out_date,
        name: args.p_name,
        address: args.p_address,
        phone: args.p_phone,
        version: Number(prior?.version ?? 0) + 1,
      };
      stays = prior
        ? stays.map((candidate) =>
            candidate.id === prior.id ? stay : candidate,
          )
        : [...stays, stay];
      result = stay;
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
        expense_date: args.p_expense_date,
        expense_time: args.p_expense_time,
        version: 1,
        expense_shares:
          args.p_shares?.map((share) => ({
            trip_member_id: share.member_id,
            owed_minor: share.owed_minor,
          })) ?? [],
      };
      expenses = [exp, ...expenses];
      result = exp;
    } else if (fn === "correct_expense") {
      savedCorrection = args;
      expenses = expenses.map((expense) =>
        expense.id === args.p_expense_id
          ? {
              ...expense,
              description: args.p_description,
              amount_minor: args.p_amount_minor,
              paid_by_member_id: args.p_payer_member_id,
              expense_date: args.p_expense_date,
              expense_time: args.p_expense_time,
              version: Number(expense.version ?? 1) + 1,
            }
          : expense,
      );
      result =
        expenses.find((expense) => expense.id === args.p_expense_id) ?? null;
    } else if (fn === "archive_trip" || fn === "restore_trip") {
      trip.status = fn === "archive_trip" ? "archived" : "active";
    } else if (fn === "delete_trip") {
      trips.splice(0, trips.length);
    } else if (fn === "create_trip") {
      const created = {
        ...trip,
        id: "55555555-5555-4555-8555-555555555555",
        title: args.p_title,
        start_date: args.p_start,
        end_date: args.p_end,
        status: "active",
      };
      trips.push(created);
      result = created.id;
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
    getSavedCorrection: () => savedCorrection,
    getRpcCalls: () => rpcCalls,
    getStays: () => stays,
    failNextCheckIn: () => {
      failCheckInOnce = true;
    },
    getCheckInOperationIds: () =>
      rpcCalls
        .filter((call) => call.fn === "check_in")
        .map((call) => call.args.p_operation_id),
    getCheckInCount: () => checkIns.length,
  };
}

async function openTrip(page: import("@playwright/test").Page) {
  const dashboard = page.getByRole("region", { name: "Choose a trip" });
  const tripCard = dashboard.getByRole("button", { name: /Bangkok Weekend/ });
  await expect(tripCard).toBeVisible();
  await tripCard.click();
  await expect(tripCard).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Bangkok Weekend" }),
  ).toBeVisible();
  return tripCard;
}

async function expectInViewport(locator: import("@playwright/test").Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const viewportHeight = await locator
        .page()
        .evaluate(() => window.innerHeight);
      const scrollY = await locator.page().evaluate(() => window.scrollY);
      if (!box) return "missing";
      return box.y >= 0 && box.y + box.height <= viewportHeight
        ? "fully-visible"
        : `offscreen y=${box.y.toFixed(1)} bottom=${(box.y + box.height).toFixed(1)} viewport=${viewportHeight} scrollY=${scrollY.toFixed(1)}`;
    })
    .toBe("fully-visible");
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-02T03:00:00.000Z") });
});

test("mocked enrolled itinerary and expense flow; keyboard and labels; preview capture", async ({
  page,
}, testInfo) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "PaiKan" })).toBeFocused();
  await openTrip(page);
  await expect(
    page
      .getByRole("region", { name: "Choose a trip" })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Wat Arun" })).toBeVisible();
  const todayCard = page.locator(".next-stop");
  await expect(todayCard).toContainText("Current stop");
  await expect(todayCard).toContainText("Wat Arun");
  await expect(todayCard).toContainText("Next stop");
  await expect(todayCard).toContainText("Chatuchak Market");
  await expect(todayCard).not.toContainText("Old Town Walk");
  await expect(
    page.getByText("Niran — Not checked in", { exact: true }),
  ).toBeVisible();

  const destination = page.getByLabel("Place or activity");
  await page.locator(".stop-editor summary").click();
  await expect(destination).toBeVisible();

  await destination.fill("Lunch at Or Tor Kor");
  const stopEditor = page.locator(".stop-editor");
  await stopEditor.getByLabel("Address").fill("Kamphaeng Phet 2 Road");
  await stopEditor.getByLabel("Notes").fill("Arrive before noon");
  await page.getByLabel("Day").fill("2026-11-02");
  await page.getByLabel("Local time (optional)").fill("09:00");
  await page.getByLabel("Transport").selectOption("train");
  await page.getByRole("button", { name: "Save stop" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Stop saved." }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        fixtureState
          .getRpcCalls()
          .find((call) => call.fn === "upsert_itinerary_item")?.args,
    )
    .toMatchObject({
      p_title: "Lunch at Or Tor Kor",
      p_plan_date: "2026-11-02",
      p_transport_mode: "train",
    });
  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-itinerary-fixture-preview.png`,
  });

  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Expenses" })
    .click();
  await page.locator(".expense-entry > summary").click();
  const expenseEntry = page.locator(".expense-entry");
  await expenseEntry.getByLabel("What was it for?").fill("Street food");
  await expenseEntry.getByLabel("Amount (THB)").fill("6.01");
  await expenseEntry.getByLabel("Date (optional)").fill("2026-11-02");
  await expenseEntry.getByLabel("Time (optional, requires date)").fill("12:34");
  await expenseEntry.getByRole("button", { name: "Save expense" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent and confirmed." }),
  ).toBeVisible();
  await expect
    .poll(() => fixtureState.getSavedExpense())
    .toMatchObject({
      p_amount_minor: "601",
      p_currency: "THB",
      p_description: "Street food",
      p_expense_date: "2026-11-02",
      p_expense_time: "12:34",
      p_payer_member_id: alice,
      p_shares: [
        { member_id: alice, owed_minor: "301" },
        { member_id: bob, owed_minor: "300" },
      ],
    });
  expect(fixtureState.getSavedExpense()?.p_operation_id).toEqual(
    expect.any(String),
  );
  await expect(page.getByText("Airport taxi", { exact: true })).toBeVisible();

  const addedExpense = page
    .locator("article.stop")
    .filter({ hasText: "Street food" });
  await expect(addedExpense).toContainText("2026-11-02");
  await addedExpense.getByText("Correct expense").click();
  await addedExpense.getByLabel("Description").fill("Street food corrected");
  await addedExpense.getByLabel("Amount (THB)").fill("7.25");
  await addedExpense.getByLabel("Date (optional)").fill("2026-11-03");
  await addedExpense.getByLabel("Time (optional)").fill("13:45");
  await addedExpense.getByRole("button", { name: "Save correction" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Expense corrected." }),
  ).toBeVisible();
  await expect
    .poll(() => fixtureState.getSavedCorrection())
    .toMatchObject({
      p_expense_id: "expense-added",
      p_expected_version: 1,
      p_currency: "THB",
      p_amount_minor: "725",
      p_description: "Street food corrected",
      p_expense_date: "2026-11-03",
      p_expense_time: "13:45",
    });
  expect(fixtureState.getSavedCorrection()?.p_operation_id).toEqual(
    expect.any(String),
  );

  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-expenses-fixture-preview.png`,
  });
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-fixture-preview.png`,
    fullPage: true,
  });
});

test("trip plan saves inclusive night ranges, accommodation, and a timezone-aware daily activity", async ({
  page,
}) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await openTrip(page);
  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Plan" })
    .click();
  const plan = page.getByRole("region", { name: "Trip plan" });

  await plan
    .getByText("Add city for a night or range", { exact: true })
    .click();
  await plan.getByLabel("From (night of)").fill("2026-11-01");
  await plan.getByLabel("Through (inclusive)").fill("2026-11-03");
  await plan.getByLabel("City", { exact: true }).first().fill("Chiang Mai");
  await plan.getByLabel("Travel mode into this city").selectOption("train");
  await plan
    .getByLabel("I understand this will overwrite the selected nights")
    .check();
  await plan.getByRole("button", { name: "Save destination" }).click();
  await expect(plan.getByText("Destination nights saved.")).toBeVisible();
  await expect
    .poll(
      () =>
        fixtureState
          .getRpcCalls()
          .find((call) => call.fn === "set_nightly_destinations")?.args,
    )
    .toMatchObject({
      p_start_date: "2026-11-01",
      p_end_date: "2026-11-03",
      p_city: "Chiang Mai",
      p_transport_mode: "train",
      p_replace: true,
      p_expected_versions: { "2026-11-01": 1, "2026-11-02": 1 },
    });
  await expect(plan.getByText("Chiang Mai", { exact: true })).toHaveCount(3);

  await plan
    .locator(".plan-night")
    .nth(1)
    .getByRole("button", { name: "Edit this night" })
    .click();
  await plan
    .getByLabel("I understand this will overwrite the selected nights")
    .check();
  await plan.getByLabel("City", { exact: true }).last().fill("Ayutthaya");
  await plan.getByRole("button", { name: "Save night or range" }).click();
  await expect
    .poll(
      () =>
        fixtureState
          .getRpcCalls()
          .filter((call) => call.fn === "set_nightly_destinations")
          .at(-1)?.args,
    )
    .toMatchObject({
      p_start_date: "2026-11-02",
      p_end_date: "2026-11-02",
      p_city: "Ayutthaya",
      p_replace: true,
      p_expected_versions: { "2026-11-02": 1 },
    });

  await plan.getByText("Add accommodation", { exact: true }).click();
  await plan.getByLabel("Name", { exact: true }).fill("Riverside Hotel");
  await plan.getByLabel("Check-in").fill("2026-11-01");
  await plan.getByLabel("Check-out (exclusive)").fill("2026-11-03");
  await plan.getByLabel("Address").fill("1 River Road");
  await plan.getByLabel("Phone").fill("+66 2 123 4567");
  await plan.getByRole("button", { name: "Save accommodation" }).click();
  await expect
    .poll(
      () =>
        fixtureState.getRpcCalls().find((call) => call.fn === "upsert_stay")
          ?.args,
    )
    .toMatchObject({
      p_check_in_date: "2026-11-01",
      p_check_out_date: "2026-11-03",
      p_name: "Riverside Hotel",
      p_address: "1 River Road",
      p_phone: "+66 2 123 4567",
      p_stay_id: null,
      p_expected_version: null,
    });

  await plan
    .locator(".plan-night")
    .nth(1)
    .getByRole("button", { name: "Add activity" })
    .click();
  await plan.getByLabel("Day").fill("2026-11-02");
  await plan
    .getByRole("textbox", { name: "Activity" })
    .fill("Doi Suthep visit");
  await plan.getByLabel("Local time").fill("09:30");
  await plan.getByLabel("Address").last().fill("Mueang Chiang Mai");
  await plan.getByLabel("Travel mode into activity").selectOption("taxi");
  await plan.getByRole("button", { name: "Save activity" }).click();
  await expect(plan.getByText("Activity saved.")).toBeVisible();
  await expect
    .poll(
      () =>
        fixtureState
          .getRpcCalls()
          .find(
            (call) =>
              call.fn === "upsert_itinerary_item" &&
              call.args.p_title === "Doi Suthep visit",
          )?.args,
    )
    .toMatchObject({
      p_plan_date: "2026-11-02",
      p_starts_at: "2026-11-02T02:30:00.000Z",
      p_transport_mode: "taxi",
      p_title: "Doi Suthep visit",
    });
  await expect(
    plan.getByText("Doi Suthep visit", { exact: true }),
  ).toBeVisible();
});

test.describe("Plan editor regressions", () => {
  test("Plan editors scroll into view, and closed accommodation Edit opens prefilled and updates the same stay", async ({
    page,
  }, testInfo) => {
    const fixtureState = await installFixture(page);
    await page.goto("/");
    await openTrip(page);
    const tabs = page.getByRole("navigation", { name: "Trip sections" });
    await tabs.getByRole("button", { name: "Plan" }).click();
    const plan = page.getByRole("region", { name: "Trip plan" });

    await plan
      .getByText("Add city for a night or range", { exact: true })
      .click();
    const nightForm = plan.locator("form.plan-form").first();
    await expectInViewport(nightForm.getByLabel("From (night of)"));
    await nightForm.getByLabel("From (night of)").fill("2026-11-03");
    await nightForm.getByLabel("Through (inclusive)").fill("2026-11-03");
    await nightForm
      .getByLabel("City", { exact: true })
      .first()
      .fill("Test city");
    await nightForm.getByRole("button", { name: "Save destination" }).click();
    await plan
      .locator(".plan-night")
      .nth(1)
      .getByRole("button", { name: "Edit this night" })
      .click();
    const editNightForm = plan.locator("form.plan-form").first();
    await expectInViewport(editNightForm.getByLabel("From (night of)"));
    // Selecting another item while the editor is open must keep the editor usable.
    await plan
      .locator(".plan-night")
      .nth(0)
      .getByRole("button", { name: "Edit this night" })
      .click();
    await expectInViewport(editNightForm.getByLabel("From (night of)"));

    await plan.getByText("Add accommodation", { exact: true }).click();
    const addStayForm = plan.locator(".plan-stays form.plan-form");
    await expectInViewport(addStayForm.getByLabel("Name", { exact: true }));
    await addStayForm
      .getByLabel("Name", { exact: true })
      .fill("Riverside Hotel");
    await addStayForm.getByLabel("Check-in").fill("2026-11-01");
    await addStayForm.getByLabel("Check-out (exclusive)").fill("2026-11-03");
    await addStayForm.getByLabel("Address").fill("1 River Road");
    await addStayForm.getByLabel("Phone").fill("+66 2 123 4567");
    await addStayForm
      .getByRole("button", { name: "Save accommodation" })
      .click();

    const originalStay = plan
      .locator(".plan-stay")
      .filter({ hasText: "River House" });
    await originalStay.getByRole("button", { name: "Edit" }).click();
    const editStayForm = plan.locator(".plan-stays form.plan-form");
    await expectInViewport(editStayForm.getByLabel("Name", { exact: true }));
    await expect(editStayForm.getByLabel("Name", { exact: true })).toHaveValue(
      "River House",
    );
    await expect(editStayForm.getByLabel("Check-in")).toHaveValue("2026-11-01");
    await expect(editStayForm.getByLabel("Check-out (exclusive)")).toHaveValue(
      "2026-11-03",
    );
    await expect(editStayForm.getByLabel("Address")).toHaveValue(
      "1 River Road",
    );
    await expect(editStayForm.getByLabel("Phone")).toHaveValue(
      "+66 2 123 4567",
    );
    const currentViewport = page.viewportSize();
    if (currentViewport && currentViewport.width > 600)
      await page.setViewportSize({
        width: currentViewport.width,
        height: Math.max(currentViewport.height, 1100),
      });
    await editStayForm.screenshot({
      path: `artifacts/${testInfo.project.name}-accommodation-editor-fixture-preview.png`,
    });
    await editStayForm
      .getByLabel("Name", { exact: true })
      .fill("River House Updated");
    await editStayForm
      .getByRole("button", { name: "Save accommodation" })
      .click();
    await expect
      .poll(
        () =>
          fixtureState
            .getRpcCalls()
            .filter((call) => call.fn === "upsert_stay")
            .at(-1)?.args,
      )
      .toMatchObject({
        p_stay_id: "stay-1",
        p_expected_version: 1,
        p_name: "River House Updated",
      });
    await expect
      .poll(() => fixtureState.getStays().find((stay) => stay.id === "stay-1"))
      .toMatchObject({
        id: "stay-1",
        name: "River House Updated",
        version: 2,
      });
    await expect(
      plan.locator(".plan-stay").filter({ hasText: "River House Updated" }),
    ).toBeVisible();

    const addActivityButton = plan
      .locator(".plan-night")
      .nth(1)
      .getByRole("button", { name: "Add activity" });
    await addActivityButton.click();
    await expectInViewport(
      plan.locator(".plan-activity-editor").getByLabel("Day"),
    );
  });
});

test.describe("Browser timezone differs from trip timezone", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("Today stop and Plan activity edits use the device local date and time", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-02T17:00:00.000Z"));
    const fixtureState = await installFixture(page);
    await page.goto("/");
    await openTrip(page);

    await page.locator(".stop-editor summary").click();
    const stopEditor = page.locator(".stop-editor");
    await expectInViewport(stopEditor.getByLabel("Place or activity"));
    await stopEditor.getByLabel("Place or activity").fill("LA breakfast");
    await stopEditor.getByLabel("Day").fill("2026-11-02");
    await stopEditor.getByLabel("Local time (optional)").fill("09:30");
    await stopEditor.getByRole("button", { name: "Save stop" }).click();
    await expect
      .poll(
        () =>
          fixtureState
            .getRpcCalls()
            .filter((call) => call.fn === "upsert_itinerary_item")
            .at(-1)?.args,
      )
      .toMatchObject({
        p_title: "LA breakfast",
        p_item_id: null,
        p_plan_date: "2026-11-02",
        p_starts_at: "2026-11-02T17:30:00.000Z",
      });

    const stop = page
      .locator("article.stop")
      .filter({ hasText: "LA breakfast" });
    await expect(stop).toBeVisible();
    await stop.getByRole("button", { name: "Edit stop" }).click();
    await expectInViewport(stopEditor.getByLabel("Place or activity"));
    await expect(stopEditor.getByLabel("Day")).toHaveValue("2026-11-02");
    await expect(stopEditor.getByLabel("Local time (optional)")).toHaveValue(
      "09:30",
    );
    await stopEditor.getByLabel("Local time (optional)").fill("10:00");
    await stopEditor.getByRole("button", { name: "Save stop" }).click();
    await expect
      .poll(
        () =>
          fixtureState
            .getRpcCalls()
            .filter((call) => call.fn === "upsert_itinerary_item")
            .at(-1)?.args,
      )
      .toMatchObject({
        p_item_id: "stop-added",
        p_expected_version: 1,
        p_plan_date: "2026-11-02",
        p_starts_at: "2026-11-02T18:00:00.000Z",
      });

    await page
      .getByRole("navigation", { name: "Trip sections" })
      .getByRole("button", { name: "Plan" })
      .click();
    const plan = page.getByRole("region", { name: "Trip plan" });
    const legacyActivity = plan
      .locator(".plan-activity")
      .filter({ hasText: "Wat Arun" });
    await legacyActivity.getByRole("button", { name: "Edit activity" }).click();
    const legacyEditor = plan.locator(".plan-activity-editor");
    await expectInViewport(legacyEditor.getByLabel("Day"));
    await expect(legacyEditor.getByLabel("Day")).toHaveValue("2026-11-01");
    await expect(legacyEditor.getByLabel("Local time")).toHaveValue("18:00");
    await legacyEditor.getByRole("button", { name: "Save activity" }).click();
    await expect
      .poll(
        () =>
          fixtureState
            .getRpcCalls()
            .filter((call) => call.fn === "upsert_itinerary_item")
            .at(-1)?.args,
      )
      .toMatchObject({
        p_item_id: "stop-1",
        p_expected_version: 1,
        p_plan_date: "2026-11-01",
        p_starts_at: "2026-11-02T02:00:00.000Z",
      });

    const activity = plan
      .locator(".plan-activity")
      .filter({ hasText: "LA breakfast" });
    await activity.getByRole("button", { name: "Edit activity" }).click();
    const editor = plan.locator(".plan-activity-editor");
    await expectInViewport(editor.getByLabel("Day"));
    await expect(editor.getByLabel("Day")).toHaveValue("2026-11-02");
    await expect(editor.getByLabel("Local time")).toHaveValue("10:00");
    await editor.getByLabel("Local time").fill("10:15");
    await editor.getByRole("button", { name: "Save activity" }).click();
    await expect
      .poll(
        () =>
          fixtureState
            .getRpcCalls()
            .filter((call) => call.fn === "upsert_itinerary_item")
            .at(-1)?.args,
      )
      .toMatchObject({
        p_item_id: "stop-added",
        p_expected_version: 2,
        p_plan_date: "2026-11-02",
        p_starts_at: "2026-11-02T18:15:00.000Z",
      });
  });
});

test("trip creation carries its date range; archive and restore work; wrong deletion title sends no RPC", async ({
  page,
}) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await page.locator("details.create-trip > summary").click();
  await page.getByLabel("Trip name").fill("Kyoto Spring");
  await page.getByLabel("Your name").fill("Mali");
  await page.getByLabel("Start date").fill("2027-03-20");
  await page.getByLabel("End date").fill("2027-03-24");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect
    .poll(
      () =>
        fixtureState.getRpcCalls().find((call) => call.fn === "create_trip")
          ?.args,
    )
    .toMatchObject({
      p_title: "Kyoto Spring",
      p_start: "2027-03-20",
      p_end: "2027-03-24",
      p_currency: "THB",
    });

  await openTrip(page);
  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Trip" })
    .click();
  await expect(
    page.getByText("Trip settings and access", { exact: true }),
  ).toBeVisible();
  await page.getByText("Trip settings and access", { exact: true }).click();
  await page.getByRole("button", { name: "Archive trip" }).click();
  await expect
    .poll(
      () =>
        fixtureState.getRpcCalls().find((call) => call.fn === "archive_trip")
          ?.args,
    )
    .toEqual({ p_trip_id: tripId });
  await page.getByRole("button", { name: "Restore trip" }).click();
  await expect
    .poll(
      () =>
        fixtureState.getRpcCalls().find((call) => call.fn === "restore_trip")
          ?.args,
    )
    .toEqual({ p_trip_id: tripId });

  await page.getByText("Delete trip", { exact: true }).click();
  await page.getByLabel("Trip title").last().fill("Wrong title");
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The title does not match." }),
  ).toBeVisible();
  await expect(
    fixtureState.getRpcCalls().filter((call) => call.fn === "delete_trip"),
  ).toHaveLength(0);

  await page.getByLabel("Trip title").last().fill("Bangkok Weekend");
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect
    .poll(
      () =>
        fixtureState.getRpcCalls().find((call) => call.fn === "delete_trip")
          ?.args,
    )
    .toEqual({ p_trip_id: tripId, p_confirmation_title: "Bangkok Weekend" });
});

test("offline check-in stays queued until reconnect, then receives fixture acknowledgement", async ({
  page,
  context,
}) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await openTrip(page);
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
      p_item_id: "stop-next",
    });
});

test("failed offline action can be inspected and retried with its original ID", async ({
  page,
  context,
}, testInfo) => {
  const fixtureState = await installFixture(page);
  await page.goto("/");
  await openTrip(page);
  fixtureState.failNextCheckIn();
  await context.setOffline(true);
  await page.getByRole("button", { name: "I'm Here" }).click();
  await context.setOffline(false);
  const queue = page.locator(".offline-queue");
  await queue.locator("summary").click();
  const operation = queue.locator(".offline-operation");
  await expect(operation).toContainText("Failed");
  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-offline-queue-fixture-preview.png`,
    style: "header, .activity-tabs { position: static !important; }",
  });
  const originalId = fixtureState.getCheckInOperationIds()[0];
  expect(originalId).toEqual(expect.any(String));
  await operation.getByRole("button", { name: "Retry" }).click();
  await expect(operation).toHaveCount(0);
  expect(fixtureState.getCheckInOperationIds()).toEqual([
    originalId,
    originalId,
  ]);
  expect(fixtureState.getCheckInCount()).toBe(1);
});

test("guest account warns before sign-out and can stay signed in", async ({
  page,
}) => {
  await installFixture(page, { guest: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Guest account" }).click();
  await page.getByRole("button", { name: "Sign out of this device" }).click();
  const warning = page.getByRole("alert", { name: "Confirm sign out" });
  await expect(warning).toContainText("guest account can lose access");
  await expect(warning).toContainText("supervised recovery");
  await warning.getByRole("button", { name: "Keep signed in" }).click();
  await expect(
    page.getByRole("button", { name: "Guest account" }),
  ).toBeVisible();
});

test("email account confirms sign-out of this device", async ({ page }) => {
  await installFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "fixture@example.test" }).click();
  await page.getByRole("button", { name: "Sign out of this device" }).click();
  const warning = page.getByRole("alert", { name: "Confirm sign out" });
  await expect(warning).toContainText("sign in again with your email");
  await warning.getByRole("button", { name: "Confirm sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Reconnect to your trip" }),
  ).toBeVisible();
});

test("Senior view persists on this device and hides editing tabs", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  await page.goto("/");
  await page.screenshot({
    path: `artifacts/${testInfo.project.name}-dashboard-fixture-preview.png`,
    fullPage: true,
  });
  await openTrip(page);
  await page.getByRole("button", { name: "Senior view" }).click();
  await expect(
    page.getByRole("button", { name: "Exit senior view" }),
  ).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Trip sections" });
  await expect(tabs.getByRole("button", { name: "Plan" })).toHaveCount(0);
  await expect(tabs.getByRole("button", { name: "Expenses" })).toHaveCount(0);
  await expect(tabs).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit stop" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Itinerary" })).toHaveCount(0);
  await expect(
    page.getByText("Niran — Not checked in", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".activity").screenshot({
    path: `artifacts/${testInfo.project.name}-senior-fixture-preview.png`,
    style: "header, .activity-tabs { position: static !important; }",
  });
  await page.reload();
  await openTrip(page);
  await expect(
    page.getByRole("button", { name: "Exit senior view" }),
  ).toBeVisible();
});

test("captures Today, Plan, Expenses, and Trip previews with a fixed Bangkok date", async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date("2026-11-02T03:00:00.000Z") });
  await installFixture(page);
  await page.goto("/");
  await openTrip(page);
  const activity = page.locator(".activity");
  const screenshot = async (tab: string) => {
    const { viewportWidth, documentWidth } = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(documentWidth, `${tab} tab should not scroll horizontally`).toBeLessThanOrEqual(
      viewportWidth,
    );
    await activity.screenshot({
      path: `artifacts/${testInfo.project.name}-${tab}-fixture-preview.png`,
      style: "header, .activity-tabs { position: static !important; }",
    });
  };
  await expect(
    page.getByRole("region", { name: "Tonight destination and accommodation" }),
  ).toContainText("Bangkok");
  await screenshot("today");
  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Plan" })
    .click();
  await expect(page.locator(".plan-night").first()).toContainText("Bangkok");
  await screenshot("plan");
  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Expenses" })
    .click();
  await expect(page.getByText("Airport taxi", { exact: true })).toBeVisible();
  await screenshot("expenses");
  await page
    .getByRole("navigation", { name: "Trip sections" })
    .getByRole("button", { name: "Trip", exact: true })
    .click();
  await page.getByText("Delete trip", { exact: true }).click();
  await expect(page.locator(".help-card > strong")).toContainText(
    "Family contact",
  );
  await expect(
    page.getByRole("link", { name: "Call: +66 81 234 5678" }),
  ).toBeVisible();
  await screenshot("trip");
});
