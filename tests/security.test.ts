// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
test("RLS, approval, duplicate redemption, expiry and revocation", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610280001_foundation.sql", "utf8"),
  );
  const a = "00000000-0000-4000-8000-000000000001",
    b = "00000000-0000-4000-8000-000000000002";
  await db.exec(
    `insert into auth.users values ('${a}'),('${b}');set role authenticated;set request.jwt.claim.sub='${a}';`,
  );
  const trip = (
    await db.query<{ id: string }>(
      `select create_trip('Test','Organizer','Asia/Bangkok','THB','2026-10-28','2026-10-29') as id`,
    )
  ).rows[0].id;
  const invite = (
    await db.query<{ id: string; token: string }>(
      `select * from create_invite('${trip}',24,1)`,
    )
  ).rows[0];
  await db.exec(`set request.jwt.claim.sub='${b}'`);
  expect((await db.query("select * from trips")).rows).toHaveLength(0);
  await expect(db.query(`select create_invite('${trip}')`)).rejects.toThrow();
  await expect(db.query("select * from trip_invites")).rejects.toThrow();
  await db.exec("reset role");
  const redeem = () =>
    db.query<{ result: { status?: string; error?: string } }>(
      `select invite_gateway(encode(sha256(convert_to('${invite.token}','UTF8')),'hex'),repeat('a',64),'${b}','Traveler') as result`,
    );
  expect((await redeem()).rows[0].result.status).toBe("pending");
  expect((await redeem()).rows[0].result.status).toBe("pending");
  expect(
    (
      await db.query<{ uses_count: number }>(
        "select uses_count from trip_invites",
      )
    ).rows[0].uses_count,
  ).toBe(1);
  const request = (
    await db.query<{ id: string }>("select id from trip_join_requests")
  ).rows[0].id;
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${b}'`);
  expect((await db.query("select * from trips")).rows).toHaveLength(0);
  await expect(
    db.query(`select decide_join('${request}',true)`),
  ).rejects.toThrow();
  await db.exec(
    `set request.jwt.claim.sub='${a}';select decide_join('${request}',true);set request.jwt.claim.sub='${b}'`,
  );
  expect((await db.query("select * from trips")).rows).toHaveLength(1);
  const tripB = (
    await db.query<{ id: string }>(
      `select create_trip('Other','Traveler','Asia/Bangkok','THB','2026-10-28','2026-10-29') as id`,
    )
  ).rows[0].id;
  await db.exec(`set request.jwt.claim.sub='${a}'`);
  expect(
    (await db.query(`select * from trips where id='${tripB}'`)).rows,
  ).toHaveLength(0);
  expect(
    (await db.query(`select * from trip_members where trip_id='${tripB}'`))
      .rows,
  ).toHaveLength(0);
  await expect(db.query(`select archive_trip('${tripB}')`)).rejects.toThrow();
  const member = (
    await db.query<{ id: string }>(
      `select id from trip_members where user_id='${b}'`,
    )
  ).rows[0].id;
  await db.exec(
    `select remove_member('${member}');set request.jwt.claim.sub='${b}'`,
  );
  expect(
    (await db.query(`select * from trips where id='${trip}'`)).rows,
  ).toHaveLength(0);
  expect(
    (await db.query(`select * from trip_members where trip_id='${trip}'`)).rows,
  ).toHaveLength(0);
  await db.exec(
    `reset role;update trip_invites set expires_at=now()-interval '1 hour'`,
  );
  expect((await redeem()).rows[0].result.error).toBe("invalid_invite");
  await db.exec(
    `update trip_invites set expires_at=now()+interval '1 hour',revoked_at=now()`,
  );
  expect((await redeem()).rows[0].result.error).toBe("invalid_invite");
  await db.close();
}, 30000);
