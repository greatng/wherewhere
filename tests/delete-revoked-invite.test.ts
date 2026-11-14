// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("only an organizer can soft-delete revoked invitations and history stays linked", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      readFileSync("supabase/migrations/202610280001_foundation.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261114140713_delete_revoked_trip_invites.sql",
        "utf8",
      ),
    );
    expect(
      (
        await db.query<{ anon: boolean; authenticated: boolean }>(
          `select has_function_privilege('anon','public.delete_revoked_invite(uuid)','execute') anon,has_function_privilege('authenticated','public.delete_revoked_invite(uuid)','execute') authenticated`,
        )
      ).rows[0],
    ).toEqual({ anon: false, authenticated: true });
    const organizer = "00000000-0000-4000-8000-000000000001";
    const outsider = "00000000-0000-4000-8000-000000000002";
    await db.exec(
      `insert into auth.users(id) values('${organizer}'),('${outsider}');set role authenticated;set request.jwt.claim.sub='${organizer}'`,
    );
    const trip = (
      await db.query<{ id: string }>(
        `select create_trip('Japan','Organizer','Asia/Tokyo','JPY','2026-11-01','2026-11-06') id`,
      )
    ).rows[0].id;
    const active = (
      await db.query<{ id: string }>(
        `select id from create_invite('${trip}')`,
      )
    ).rows[0].id;
    await expect(
      db.query(`select delete_revoked_invite('${active}')`),
    ).rejects.toThrow("Only revoked invitations");

    const revoked = (
      await db.query<{ id: string }>(
        `select id from create_invite('${trip}')`,
      )
    ).rows[0].id;
    await db.query(`select revoke_invite('${revoked}')`);
    await db.exec("reset role");
    await db.query(
      `insert into trip_join_requests(trip_id,invite_id,auth_user_id,requested_display_name) values('${trip}','${revoked}','${outsider}','Guest')`,
    );
    await db.exec(
      `set role authenticated;set request.jwt.claim.sub='${outsider}'`,
    );
    await expect(
      db.query(`select delete_revoked_invite('${revoked}')`),
    ).rejects.toThrow("Organizer");
    await db.exec(
      `set request.jwt.claim.sub='${organizer}'`,
    );
    await db.query(`select delete_revoked_invite('${revoked}')`);
    await db.query(`select delete_revoked_invite('${revoked}')`);
    expect((await db.query("select id from trip_invites")).rows).toEqual([
      { id: active },
    ]);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ deleted_at: Date; invite_id: string }>(
          `select i.deleted_at,j.invite_id from trip_invites i join trip_join_requests j on j.invite_id=i.id where i.id='${revoked}'`,
        )
      ).rows[0],
    ).toMatchObject({ invite_id: revoked });
    expect(
      (
        await db.query<{ deleted_at: Date }>(
          `select deleted_at from trip_invites where id='${revoked}'`,
        )
      ).rows[0].deleted_at,
    ).toBeInstanceOf(Date);
  } finally {
    await db.close();
  }
}, 60000);
