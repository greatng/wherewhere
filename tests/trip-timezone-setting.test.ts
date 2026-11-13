// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("trip timezone changes require the active organizer and preserve saved instants", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const file of [
      "202610280001_foundation.sql",
      "202610280002_itinerary_checkins_expenses.sql",
      "202610280003_daily_planning.sql",
      "202610310004_email_trip_creators.sql",
      "202611060005_supervised_guest_recovery.sql",
      "202611110006_local_activity_dates.sql",
      "202611130007_trip_timezone_setting.sql",
    ])
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const organizer = "00000000-0000-4000-8000-000000000001";
    const outsider = "00000000-0000-4000-8000-000000000002";
    await db.exec(
      `insert into auth.users(id,email,email_confirmed_at) values('${organizer}','org@example.com',now()),('${outsider}','other@example.com',now());set role authenticated;set request.jwt.claim.sub='${organizer}'`,
    );
    const trip = (
      await db.query<{ id: string }>(
        `select create_trip('Japan','Organizer','Asia/Tokyo','JPY','2026-11-01','2026-11-06') id`,
      )
    ).rows[0].id;
    await db.query(
      `select upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Dinner',p_starts_at=>'2026-11-01T16:00:00Z',p_plan_date=>'2026-11-02')`,
    );
    await expect(
      db.query(`select set_trip_timezone('${trip}','Not/A_Zone')`),
    ).rejects.toThrow("Invalid timezone");
    await db.exec(`set request.jwt.claim.sub='${outsider}'`);
    await expect(
      db.query(`select set_trip_timezone('${trip}','Asia/Bangkok')`),
    ).rejects.toThrow("Organizer");
    await db.exec(`set request.jwt.claim.sub='${organizer}'`);
    await db.query(`select set_trip_timezone('${trip}','Asia/Bangkok')`);
    expect(
      (
        await db.query<{ starts_at: string; plan_date: Date; timezone: string }>(
          `select i.starts_at, i.plan_date, t.timezone from itinerary_items i join trips t on t.id=i.trip_id where i.trip_id='${trip}'`,
        )
      ).rows[0],
    ).toMatchObject({
      starts_at: new Date("2026-11-01T16:00:00.000Z"),
      plan_date: new Date("2026-11-02T00:00:00.000Z"),
      timezone: "Asia/Bangkok",
    });
  } finally {
    await db.close();
  }
}, 60000);
