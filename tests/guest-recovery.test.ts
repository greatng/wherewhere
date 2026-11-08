// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("organizer-supervised recovery preserves member history and scopes identity access", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const file of [
    "202610280001_foundation.sql",
    "202610280002_itinerary_checkins_expenses.sql",
    "202610280003_daily_planning.sql",
    "202610310004_email_trip_creators.sql",
    "202611060005_supervised_guest_recovery.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

  const organizer = "00000000-0000-4000-8000-000000000101";
  const oldGuest = "00000000-0000-4000-8000-000000000102";
  const newGuest = "00000000-0000-4000-8000-000000000103";
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    ('${organizer}','org@test.example',now(),false),('${oldGuest}','',null,true),('${newGuest}','',null,true);
    set role authenticated; set request.jwt.claim.sub='${organizer}';`);
  const trip = (
    await db.query<{ id: string }>(
      `select create_trip('Recovery','Owner','UTC','USD','2026-11-01','2026-11-03') id`,
    )
  ).rows[0].id;
  const invite = (
    await db.query<{ token: string }>(
      `select token from create_invite('${trip}',24,2)`,
    )
  ).rows[0].token;
  await db.exec("reset role; set role service_role;");
  const hash = (
    await db.query<{ h: string }>(
      `select encode(sha256(convert_to('${invite}','UTF8')),'hex') h`,
    )
  ).rows[0].h;
  const oldRequest = (
    await db.query<{ r: { request_id: string } }>(
      `select invite_gateway('${hash}',repeat('a',64),'${oldGuest}','Old device') r`,
    )
  ).rows[0].r.request_id;
  await db.exec(
    `reset role; set role authenticated; set request.jwt.claim.sub='${organizer}';`,
  );
  await db.query(`select decide_join('${oldRequest}',true)`);
  const member = (
    await db.query<{ id: string }>(
      `select id from trip_members where trip_id='${trip}' and user_id='${oldGuest}'`,
    )
  ).rows[0].id;
  // A denied request can be explicitly reopened, but reopening never approves it.
  await db.query(`select remove_member('${member}')`);
  await db.query(`select reopen_join_request('${oldRequest}',true,null)`);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from trip_join_requests where id='${oldRequest}'`,
      )
    ).rows[0].status,
  ).toBe("pending");
  await db.query(`select decide_join('${oldRequest}',true)`);
  expect(
    (
      await db.query<{ id: string }>(
        `select id from trip_members where trip_id='${trip}' and user_id='${oldGuest}' and status='approved'`,
      )
    ).rows[0].id,
  ).toBe(member);
  await db.query(`select remove_member('${member}')`);

  // A new guest device may be linked only through its pending request.
  await db.exec("reset role; set role service_role;");
  const newRequest = (
    await db.query<{ r: { request_id: string } }>(
      `select invite_gateway('${hash}',repeat('b',64),'${newGuest}','New device') r`,
    )
  ).rows[0].r.request_id;
  await db.exec(
    `reset role; set role authenticated; set request.jwt.claim.sub='${organizer}';`,
  );
  await expect(
    db.query(`select recover_member('${member}','${newRequest}',false)`),
  ).rejects.toThrow(/identity verification/i);
  await db.query(`select recover_member('${member}','${newRequest}',true)`);
  const recovered = await db.query<{ id: string; status: string }>(
    `select id,status from trip_members where trip_id='${trip}' and user_id='${newGuest}'`,
  );
  expect(recovered.rows).toEqual([{ id: member, status: "approved" }]);
  expect(
    (
      await db.query(
        `select id from trip_members where trip_id='${trip}' and user_id='${oldGuest}' and status='approved'`,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from trip_join_requests where id='${newRequest}'`,
      )
    ).rows[0].status,
  ).toBe("approved");
  await db.exec("reset role");
  expect(
    (
      await db.query<{
        action: string;
        from_user_id: string;
        to_user_id: string;
        changed_by: string;
      }>(
        `select action,from_user_id,to_user_id,changed_by from private.guest_recovery_audit where member_id='${member}'`,
      )
    ).rows,
  ).toEqual([
    {
      action: "recover_member",
      from_user_id: oldGuest,
      to_user_id: newGuest,
      changed_by: organizer,
    },
  ]);

  // Audit rows cascade with trip deletion, so recovery does not strand deletion.
  await db.query(`select delete_trip('${trip}','Recovery')`);
  expect(
    (
      await db.query(
        `select id from private.guest_recovery_audit where trip_id='${trip}'`,
      )
    ).rows,
  ).toHaveLength(0);
  await db.close();
}, 30000);
