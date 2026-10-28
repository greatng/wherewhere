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

test("itinerary, check-in, expense and settlement RPCs enforce trip scope and idempotency", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610280001_foundation.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610280002_itinerary_checkins_expenses.sql",
      "utf8",
    ),
  );
  const a = "00000000-0000-4000-8000-000000000011";
  const b = "00000000-0000-4000-8000-000000000012";
  const op = "00000000-0000-4000-8000-000000000099";
  await db.exec(
    `insert into auth.users values ('${a}'),('${b}');set role authenticated;set request.jwt.claim.sub='${a}'`,
  );
  const trip = (
    await db.query<{ id: string }>(
      `select create_trip('Trip A','A','Asia/Bangkok','THB','2026-10-28','2026-10-29') id`,
    )
  ).rows[0].id;
  const memberA = (
    await db.query<{ id: string }>(
      `select id from trip_members where trip_id='${trip}'`,
    )
  ).rows[0].id;
  const memberB = await db.query<{ id: string }>(
    `select add_managed_member('${trip}','B') id`,
  );
  await db.exec(
    `reset role;insert into trip_members(trip_id,user_id,display_name) values('${trip}','${b}','Device B');set role authenticated;set request.jwt.claim.sub='${a}'`,
  );
  const memberDeviceB = (
    await db.query<{ id: string }>(
      `select id from trip_members where trip_id='${trip}' and user_id='${b}'`,
    )
  ).rows[0].id;
  const item = await db.query<{ id: string }>(
    `select (upsert_itinerary_item('${trip}','Meet up')).id id`,
  );
  const itemId = item.rows[0].id;
  const checkInSql = `select (check_in('${trip}','${memberA}','${itemId}','${op}')).id id`;
  const concurrentCheckIns = await Promise.all([
    db.query<{ id: string }>(checkInSql),
    db.query<{ id: string }>(checkInSql),
  ]);
  const checkIn1 = concurrentCheckIns[0].rows[0].id;
  expect(concurrentCheckIns[1].rows[0].id).toBe(checkIn1);
  expect((await db.query("select * from check_ins")).rows).toHaveLength(1);

  const expenseOp = "00000000-0000-4000-8000-000000000098";
  const shares = JSON.stringify([
    { member_id: memberA, owed_minor: "101" },
    { member_id: memberB.rows[0].id, owed_minor: "99" },
  ]);
  const expenseSql = `select (create_expense('${trip}','${memberA}','200','THB','Lunch','${shares}'::jsonb,'${expenseOp}')).id id`;
  const concurrent = await Promise.all([
    db.query<{ id: string }>(expenseSql),
    db.query<{ id: string }>(expenseSql),
  ]);
  const expenseId = concurrent[0].rows[0].id;
  expect(concurrent[1].rows[0].id).toBe(expenseId);
  expect((await db.query("select * from expenses")).rows).toHaveLength(1);
  await expect(
    db.query(
      `select create_expense('${trip}','${memberA}','200','THB','Different payload','${shares}'::jsonb,'${expenseOp}')`,
    ),
  ).rejects.toThrow(/payload mismatch/i);
  expect(
    (
      await db.query<{ total: string }>(
        `select sum(owed_minor)::text total from expense_shares where expense_id='${expenseId}'`,
      )
    ).rows[0].total,
  ).toBe("200");
  const badShares = JSON.stringify([{ member_id: memberA, owed_minor: "199" }]);
  await expect(
    db.query(
      `select create_expense('${trip}','${memberA}','200','THB','Bad','${badShares}'::jsonb,'00000000-0000-4000-8000-000000000097')`,
    ),
  ).rejects.toThrow();
  for (const malformed of [
    `select create_expense('${trip}','${memberA}','200.5','THB','Fraction','${shares}'::jsonb,'00000000-0000-4000-8000-000000000091')`,
    `select create_expense('${trip}','${memberA}','9223372036854775808','THB','Overflow','${shares}'::jsonb,'00000000-0000-4000-8000-000000000092')`,
    `select create_expense('${trip}','${memberA}','200','USD','Wrong currency','${shares}'::jsonb,'00000000-0000-4000-8000-000000000093')`,
    `select create_expense('${trip}','${memberA}','200','THB','Fractional share','[{"member_id":"${memberA}","owed_minor":"199.5"},{"member_id":"${memberB.rows[0].id}","owed_minor":"0.5"}]'::jsonb,'00000000-0000-4000-8000-000000000094')`,
  ])
    await expect(db.query(malformed)).rejects.toThrow();
  const settlementOp = "00000000-0000-4000-8000-000000000096";
  const settlementSql = `select (record_settlement('${trip}','${memberB.rows[0].id}','${memberA}','99','${settlementOp}')).id id`;
  const settlementId = (await db.query<{ id: string }>(settlementSql)).rows[0]
    .id;
  expect((await db.query<{ id: string }>(settlementSql)).rows[0].id).toBe(
    settlementId,
  );
  expect(
    (
      await db.query<{ net_minor: string }>(
        `select net_minor::text from trip_balances('${trip}') where trip_member_id='${memberA}'`,
      )
    ).rows[0].net_minor,
  ).toBe("99");
  expect(
    (
      await db.query<{ net_minor: string }>(
        `select net_minor::text from trip_balances('${trip}') where trip_member_id='${memberB.rows[0].id}'`,
      )
    ).rows[0].net_minor,
  ).toBe("-99");
  await db.query(`select confirm_settlement('${trip}','${settlementId}')`);
  expect(
    (
      await db.query<{ net_minor: string }>(
        `select net_minor::text from trip_balances('${trip}') where trip_member_id='${memberA}'`,
      )
    ).rows[0].net_minor,
  ).toBe("0");
  expect(
    (
      await db.query<{ net_minor: string }>(
        `select net_minor::text from trip_balances('${trip}') where trip_member_id='${memberB.rows[0].id}'`,
      )
    ).rows[0].net_minor,
  ).toBe("0");
  const max = "9223372036854775807";
  await db.query(
    `select create_expense('${trip}','${memberA}','${max}','THB','Large','[{"member_id":"${memberB.rows[0].id}","owed_minor":"${max}"}]'::jsonb,'00000000-0000-4000-8000-000000000087')`,
  );
  await db.query(
    `select create_expense('${trip}','${memberA}','1','THB','Overflow balance','[{"member_id":"${memberB.rows[0].id}","owed_minor":"1"}]'::jsonb,'00000000-0000-4000-8000-000000000088')`,
  );
  expect(
    (
      await db.query<{ net_minor: string }>(
        `select net_minor from trip_balances('${trip}') where trip_member_id='${memberA}'`,
      )
    ).rows[0].net_minor,
  ).toBe("9223372036854775808");

  const otherTrip = (
    await db.query<{ id: string }>(
      `select create_trip('Trip B','A','Asia/Bangkok','THB','2026-10-28','2026-10-29') id`,
    )
  ).rows[0].id;
  await expect(
    db.query(
      `select check_in('${trip}','${memberA}','${(await db.query<{ id: string }>(`select (upsert_itinerary_item('${otherTrip}','Other trip')).id id`)).rows[0].id}','00000000-0000-4000-8000-000000000095')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.query(
      `select check_in('${trip}','${memberA}','${itemId}','00000000-0000-4000-8000-000000000094',1.0,2.0)`,
    ),
  ).rejects.toThrow(/location check-in/i);
  await db.query(
    `select upsert_emergency_card('${trip}','Hotel','Street','123','Emergency','456')`,
  );
  await db.exec(`set request.jwt.claim.sub='${b}'`);
  await expect(
    db.query(
      `select check_in('${trip}','${memberA}','${itemId}','00000000-0000-4000-8000-000000000090')`,
    ),
  ).rejects.toThrow(/cannot check in another/i);
  await db.query(
    `select check_in('${trip}','${memberDeviceB}','${itemId}','00000000-0000-4000-8000-000000000089')`,
  );
  for (const table of [
    "itinerary_items",
    "check_ins",
    "expenses",
    "expense_shares",
    "settlements",
    "emergency_cards",
  ]) {
    expect(
      (await db.query(`select * from ${table} where trip_id='${trip}'`)).rows
        .length,
    ).toBeGreaterThan(0);
  }
  await db.exec(
    `set request.jwt.claim.sub='${a}';select remove_member('${memberDeviceB}');set request.jwt.claim.sub='${b}'`,
  );
  for (const table of [
    "itinerary_items",
    "check_ins",
    "expenses",
    "expense_shares",
    "settlements",
    "emergency_cards",
  ]) {
    expect(
      (await db.query(`select * from ${table} where trip_id='${trip}'`)).rows,
    ).toHaveLength(0);
  }
  await db.close();
}, 30000);
