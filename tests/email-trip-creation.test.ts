// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

const migrationFiles = [
  "supabase/migrations/202610280001_foundation.sql",
  "supabase/migrations/202610280002_itinerary_checkins_expenses.sql",
  "supabase/migrations/202610280003_daily_planning.sql",
];

test("email verification gates trip creation while guest joins and existing access remain intact", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role;
     create schema auth;
     create table auth.users(
       id uuid primary key,
       email text,
       email_confirmed_at timestamptz,
       is_anonymous boolean not null default false
     );
     create function auth.uid() returns uuid language sql as $$
       select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
     $$;
     grant usage on schema auth to authenticated;
     grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of migrationFiles) {
    await db.exec(readFileSync(file, "utf8"));
  }

  const confirmed = "00000000-0000-4000-8000-000000000041";
  const unconfirmed = "00000000-0000-4000-8000-000000000042";
  const anonymous = "00000000-0000-4000-8000-000000000043";
  const emptyEmail = "00000000-0000-4000-8000-000000000044";
  const guestName = "QR Guest";
  await db.exec(`
    insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
      ('${confirmed}','confirmed@example.test','2026-10-20T00:00:00Z',false),
      ('${unconfirmed}','pending@example.test',null,false),
      ('${anonymous}','',null,true),
      ('${emptyEmail}','','2026-10-20T00:00:00Z',false);
  `);

  // Model a trip and membership that predate the new creation restriction.
  await db.exec(
    `set role authenticated; set request.jwt.claim.sub='${confirmed}';`,
  );
  const legacyTrip = (
    await db.query<{ id: string }>(
      `select create_trip('Existing trip','Organizer','Asia/Bangkok','THB','2026-10-28','2026-10-29') id`,
    )
  ).rows[0].id;
  await db.exec("reset role");

  await db.exec(
    readFileSync(
      "supabase/migrations/202610310004_email_trip_creators.sql",
      "utf8",
    ),
  );

  const permission = await db.query<{
    anon: boolean;
    service: boolean;
    authenticated: boolean;
  }>(`
    select
      has_function_privilege('anon','public.create_trip(text,text,text,text,date,date)','execute') anon,
      has_function_privilege('service_role','public.create_trip(text,text,text,text,date,date)','execute') service,
      has_function_privilege('authenticated','public.create_trip(text,text,text,text,date,date)','execute') authenticated
  `);
  expect(permission.rows[0]).toEqual({
    anon: false,
    service: false,
    authenticated: true,
  });

  await db.exec(
    `set role authenticated; set request.jwt.claim.sub='${confirmed}';`,
  );
  const newTrip = (
    await db.query<{ id: string }>(
      `select create_trip('New trip','Organizer','Asia/Bangkok','THB','2026-11-01','2026-11-02') id`,
    )
  ).rows[0].id;
  expect(newTrip).not.toBe(legacyTrip);

  await db.exec(
    `set request.jwt.claim.sub='${unconfirmed}'; set request.jwt.claim.email='confirmed@example.test';`,
  );
  await expect(
    db.query(
      `select create_trip('Spoof attempt','Pending','Asia/Bangkok','THB','2026-11-01','2026-11-02')`,
    ),
  ).rejects.toThrow(/verify your email/i);

  await db.exec(
    `set request.jwt.claim.sub='${anonymous}'; set request.jwt.claim.email='confirmed@example.test';`,
  );
  await expect(
    db.query(
      `select create_trip('Anonymous attempt','Guest','Asia/Bangkok','THB','2026-11-01','2026-11-02')`,
    ),
  ).rejects.toThrow(/verify your email/i);
  await db.exec(
    `set request.jwt.claim.sub='${emptyEmail}'; set request.jwt.claim.email='confirmed@example.test';`,
  );
  await expect(
    db.query(
      `select create_trip('Empty email attempt','Guest','Asia/Bangkok','THB','2026-11-01','2026-11-02')`,
    ),
  ).rejects.toThrow(/verify your email/i);
  await db.exec("reset role");

  // Existing account data and membership remain as they were before migration 004.
  const unchangedUsers = await db.query<{
    id: string;
    email: string;
    is_anonymous: boolean;
    confirmation_untouched: boolean;
  }>(`
    select id,email,is_anonymous,
      email_confirmed_at is not distinct from
        case when id in ('${confirmed}','${emptyEmail}') then '2026-10-20T00:00:00Z'::timestamptz else null end
        as confirmation_untouched
    from auth.users order by id
  `);
  expect(unchangedUsers.rows).toEqual([
    {
      id: confirmed,
      email: "confirmed@example.test",
      is_anonymous: false,
      confirmation_untouched: true,
    },
    {
      id: unconfirmed,
      email: "pending@example.test",
      is_anonymous: false,
      confirmation_untouched: true,
    },
    {
      id: anonymous,
      email: "",
      is_anonymous: true,
      confirmation_untouched: true,
    },
    {
      id: emptyEmail,
      email: "",
      is_anonymous: false,
      confirmation_untouched: true,
    },
  ]);
  await db.exec(
    `set role authenticated; set request.jwt.claim.sub='${confirmed}';`,
  );
  expect(
    (await db.query(`select id from trips where id='${legacyTrip}'`)).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query<{ id: string }>(
        `select id from trip_members where trip_id='${legacyTrip}' and user_id='${confirmed}'`,
      )
    ).rows,
  ).toHaveLength(1);
  const invite = (
    await db.query<{ token: string }>(
      `select token from create_invite('${newTrip}',24,2)`,
    )
  ).rows[0].token;
  await db.exec("reset role; set role service_role;");
  const inviteHash = (
    await db.query<{ hash: string }>(
      `select encode(sha256(convert_to('${invite}','UTF8')),'hex') hash`,
    )
  ).rows[0].hash;
  const rateKey = "a".repeat(64);
  expect(
    (
      await db.query<{ result: { valid?: boolean } }>(
        `select invite_gateway('${inviteHash}','${rateKey}',null,null) result`,
      )
    ).rows[0].result.valid,
  ).toBe(true);
  const guestJoin = (
    await db.query<{ result: { status?: string; request_id?: string } }>(
      `select invite_gateway('${inviteHash}','${"b".repeat(64)}','${anonymous}','${guestName}') result`,
    )
  ).rows[0].result;
  expect(guestJoin.status).toBe("pending");
  await db.exec(
    `reset role; set role authenticated; set request.jwt.claim.sub='${confirmed}';`,
  );
  await db.query(`select decide_join('${guestJoin.request_id}',true)`);
  await db.exec(
    `set request.jwt.claim.sub='${anonymous}'; set request.jwt.claim.email='confirmed@example.test';`,
  );
  expect(
    (await db.query(`select id from trips where id='${newTrip}'`)).rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query<{ display_name: string }>(
        `select display_name from trip_members where trip_id='${newTrip}' and user_id='${anonymous}'`,
      )
    ).rows[0].display_name,
  ).toBe(guestName);
  await db.close();
}, 30000);
