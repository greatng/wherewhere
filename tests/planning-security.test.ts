// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("upgrade: nightly ranges, stays, dated expenses, correction and deletion enforce scope", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    for (const file of [
      "202610280001_foundation.sql",
      "202610280002_itinerary_checkins_expenses.sql",
      "202610280003_daily_planning.sql",
    ])
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const a = "00000000-0000-4000-8000-000000000001",
      b = "00000000-0000-4000-8000-000000000002";
    await db.exec(
      `insert into auth.users values('${a}'),('${b}');set role authenticated;set request.jwt.claim.sub='${a}'`,
    );
    const trip = (
      await db.query<{ id: string }>(
        `select create_trip('Japan','A','Asia/Tokyo','JPY','2026-11-01','2026-11-06') id`,
      )
    ).rows[0].id;
    const member = (
      await db.query<{ id: string }>(
        `select id from trip_members where trip_id='${trip}'`,
      )
    ).rows[0].id;
    const other = (
      await db.query<{ id: string }>(
        `select add_managed_member('${trip}','B') id`,
      )
    ).rows[0].id;
    await db.query(
      `select set_nightly_destinations('${trip}','2026-11-01','2026-11-03','Tokyo','train')`,
    );
    expect(
      (await db.query("select * from nightly_destinations")).rows,
    ).toHaveLength(3);
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-11-02','2026-11-02','Kyoto','train')`,
      ),
    ).rejects.toThrow("confirm replacement");
    await db.query(
      `select set_nightly_destinations('${trip}','2026-11-02','2026-11-02','Kyoto','train',true,'{"2026-11-02":1}'::jsonb)`,
    );
    expect(
      (
        await db.query<{ city: string }>(
          `select city from nightly_destinations order by night_date`,
        )
      ).rows.map((r) => r.city),
    ).toEqual(["Tokyo", "Kyoto", "Tokyo"]);
    expect(
      (
        await db.query<{ version: number }>(
          `select version from nightly_destinations where night_date='2026-11-02'`,
        )
      ).rows[0].version,
    ).toBe(2);
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-11-02','2026-11-02','Osaka','train',true,'{"2026-11-02":1}'::jsonb)`,
      ),
    ).rejects.toThrow("changed");
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-11-01','2026-11-03','Osaka','train',true,'{"2026-11-02":2}'::jsonb)`,
      ),
    ).rejects.toThrow("changed");
    await db.query(
      `select set_nightly_destinations('${trip}','2026-11-01','2026-11-03','Osaka','train',true,'{"2026-11-01":1,"2026-11-02":2,"2026-11-03":1}'::jsonb)`,
    );
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-10-31','2026-11-01','Tokyo')`,
      ),
    ).rejects.toThrow("within");
    const stay = (
      await db.query<{ id: string }>(
        `select (upsert_stay('${trip}','2026-11-01','2026-11-03','Hotel')).id`,
      )
    ).rows[0].id;
    await expect(
      db.query(
        `select upsert_stay('${trip}','2026-11-02','2026-11-04','Overlap')`,
      ),
    ).rejects.toThrow("overlap");
    await db.query(
      `select upsert_stay('${trip}','2026-11-03','2026-11-07','Next Hotel')`,
    );
    await expect(
      db.query(`select delete_stay('${trip}','${stay}',2)`),
    ).rejects.toThrow("changed");
    const item = (
      await db.query<{ id: string }>(
        `select (upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Dinner',p_starts_at=>'2026-11-01T16:00:00Z',p_plan_date=>'2026-11-02',p_transport_mode=>'flight')).id`,
      )
    ).rows[0].id;
    await expect(
      db.query(
        `select upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Wrong day',p_starts_at=>'2026-11-01T16:00:00Z',p_plan_date=>'2026-11-01')`,
      ),
    ).rejects.toThrow("match");
    const op = "00000000-0000-4000-8000-000000000010";
    const expenseArgs = `'${trip}','${member}','100','JPY','Dinner','[{"member_id":"${other}","owed_minor":"100"}]','${op}','2026-11-01','20:30'`;
    const expense = (
      await db.query<{ id: string }>(
        `select (create_expense(${expenseArgs})).id`,
      )
    ).rows[0].id;
    await db.query(`select create_expense(${expenseArgs})`);
    await expect(
      db.query(
        `select create_expense('${trip}','${member}','100','JPY','Dinner','[{"member_id":"${other}","owed_minor":"100"}]','${op}','2026-11-02','20:30')`,
      ),
    ).rejects.toThrow("mismatch");
    const correction = `'${trip}','${expense}',1,'${member}','80','JPY','Corrected dinner','[{"member_id":"${other}","owed_minor":"80"}]','00000000-0000-4000-8000-000000000011','2026-11-01',null`;
    await db.query(`select correct_expense(${correction})`);
    await db.query(`select correct_expense(${correction})`);
    expect(
      (await db.query("select * from expense_revisions")).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query<{
          version: number;
          amount_minor: bigint;
          expense_time: string | null;
          occurrence_timezone: string;
        }>(
          "select version,amount_minor,expense_time,occurrence_timezone from expenses",
        )
      ).rows[0],
    ).toMatchObject({
      version: 2,
      expense_time: null,
      occurrence_timezone: "Asia/Tokyo",
    });
    expect(
      (
        await db.query<{ net_minor: string }>(
          `select net_minor from trip_balances('${trip}') where trip_member_id='${member}'`,
        )
      ).rows[0].net_minor,
    ).toBe("80");
    const laterCorrection = `'${trip}','${expense}',2,'${member}','90','JPY','Later correction','[{"member_id":"${other}","owed_minor":"90"}]','00000000-0000-4000-8000-000000000012','2026-11-02','08:15'`;
    await db.query(`select correct_expense(${laterCorrection})`);
    const replay = (
      await db.query<{
        version: number;
        amount_minor: bigint;
        expense_date: string;
        expense_time: string | null;
      }>(`select (correct_expense(${correction})).*`)
    ).rows[0];
    expect(replay).toMatchObject({
      version: 2,
      amount_minor: 80,
      expense_date: new Date("2026-11-01T00:00:00.000Z"),
      expense_time: null,
    });
    await expect(
      db.query(
        `select correct_expense('${trip}','${expense}',1,'${member}','81','JPY','Changed replay','[{"member_id":"${other}","owed_minor":"81"}]','00000000-0000-4000-8000-000000000011','2026-11-01',null)`,
      ),
    ).rejects.toThrow("mismatch");
    await expect(
      db.query(
        `select correct_expense('${trip}','${expense}',1,'${member}','90','JPY','Stale','[{"member_id":"${other}","owed_minor":"90"}]','00000000-0000-4000-8000-000000000015')`,
      ),
    ).rejects.toThrow("changed");
    await db.query(
      `select check_in('${trip}','${member}','${item}','00000000-0000-4000-8000-000000000013')`,
    );
    await db.query(
      `select record_settlement('${trip}','${other}','${member}','20','00000000-0000-4000-8000-000000000014')`,
    );
    await db.query(
      `select upsert_emergency_card('${trip}',p_emergency_contact_name=>'Family')`,
    );
    await db.query(`select create_invite('${trip}')`);
    await db.exec(`set request.jwt.claim.sub='${b}'`);
    for (const table of ["nightly_destinations", "stays", "expense_revisions"])
      expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
    await expect(
      db.query(`select delete_trip('${trip}','Japan')`),
    ).rejects.toThrow("Organizer");
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-11-01','2026-11-01','Attack',null,true)`,
      ),
    ).rejects.toThrow("Organizer");
    const second = (
      await db.query<{ id: string }>(
        `select create_trip('Other','B','UTC','USD','2026-11-01','2026-11-01') id`,
      )
    ).rows[0].id;
    await db.query(
      `select set_nightly_destinations('${second}','2026-11-01','2026-11-01','Other City')`,
    );
    await db.query(
      `select upsert_stay('${second}','2026-11-01','2026-11-02','Other Hotel')`,
    );
    await db.exec(`set request.jwt.claim.sub='${a}'`);
    await db.query(`select archive_trip('${trip}')`);
    await expect(
      db.query(
        `select set_nightly_destinations('${trip}','2026-11-01','2026-11-01','No',null,true)`,
      ),
    ).rejects.toThrow("archived");
    await db.query(`select restore_trip('${trip}')`);
    expect(
      (
        await db.query<{ revoked_at: unknown }>(
          `select revoked_at from trip_invites where trip_id='${trip}'`,
        )
      ).rows.every((r) => r.revoked_at !== null),
    ).toBe(true);
    await expect(
      db.query(`select delete_trip('${trip}','Wrong')`),
    ).rejects.toThrow("exact");
    await db.query(`select delete_trip('${trip}','Japan')`);
    for (const table of [
      "nightly_destinations",
      "stays",
      "expense_revisions",
      "expenses",
      "expense_shares",
      "settlements",
      "itinerary_items",
      "check_ins",
      "trip_members",
      "trip_join_requests",
      "trip_invites",
      "emergency_cards",
    ])
      expect(
        (
          await db.query(
            `select count(*)::int n from ${table} where trip_id='${trip}'`,
          )
        ).rows[0],
      ).toEqual({ n: 0 });
    await db.exec(`set request.jwt.claim.sub='${b}'`);
    expect(
      (await db.query(`select id from trips where id='${second}'`)).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          `select * from nightly_destinations where trip_id='${second}'`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query(`select * from stays where trip_id='${second}'`)).rows,
    ).toHaveLength(1);
    await db.exec("reset role");
    expect((await db.query("select * from auth.users")).rows).toHaveLength(2);
  } finally {
    await db.close();
  }
}, 60000);
