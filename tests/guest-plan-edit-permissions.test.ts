// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("approved signed-in plan editors can write planning data without gaining administration", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, is_anonymous boolean default false, email text, email_confirmed_at timestamptz); create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const file of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));

    const organizer = "00000000-0000-4000-8000-000000000001";
    const editor = "00000000-0000-4000-8000-000000000002";
    const outsider = "00000000-0000-4000-8000-000000000003";
    const otherTripUser = "00000000-0000-4000-8000-000000000004";
    const pendingUser = "00000000-0000-4000-8000-000000000005";
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,is_anonymous) values ('${organizer}','org@example.com',now(),false),('${editor}',null,null,true),('${outsider}','outsider@example.com',now(),false),('${otherTripUser}','other@example.com',now(),false),('${pendingUser}','pending@example.com',now(),false); set role authenticated; set request.jwt.claim.sub='${organizer}'`);
    const trip = (await db.query<{ id: string }>(`select create_trip('Trip','Organizer','UTC','USD','2026-11-01','2026-11-05') id`)).rows[0].id;
    await db.exec(`reset role; insert into trip_invites(trip_id,token_hash,expires_at,max_uses) values ('${trip}',repeat('a',64),now()+interval '1 day',1); insert into trip_join_requests(trip_id,invite_id,auth_user_id,requested_display_name) select '${trip}',id,'${pendingUser}','Pending' from trip_invites where trip_id='${trip}'`);
    const editorMember = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name) values('${trip}','${editor}','Editor') returning id`)).rows[0].id;
    const removed = (await db.query<{ id: string }>(`insert into trip_members(trip_id,user_id,display_name,status) values('${trip}','${outsider}','Removed','removed') returning id`)).rows[0].id;
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${organizer}'`);
    const managed = (await db.query<{ id: string }>(`select add_managed_member('${trip}','Device') id`)).rows[0].id;
    await expect(db.query(`select set_member_plan_permission('${managed}',true)`)).rejects.toThrow(/signed-in members/i);
    await expect(db.query(`select set_member_plan_permission('${removed}',true)`)).rejects.toThrow(/signed-in members/i);
    await db.exec(`reset role; update trip_members set can_edit_plan=true where id='${removed}'; set role authenticated; set request.jwt.claim.sub='${organizer}'`);
    await db.exec(`set request.jwt.claim.sub='${editor}'`);
    await expect(db.query(`select set_nightly_destinations('${trip}','2026-11-01','2026-11-01','Before grant')`)).rejects.toThrow(/plan editor/i);
    await db.exec(`set request.jwt.claim.sub='${organizer}'`);
    await db.query(`select set_member_plan_permission('${editorMember}',true)`);
    expect((await db.query<{ can_edit_plan: boolean }>(`select can_edit_plan from trip_members where id='${editorMember}'`)).rows[0].can_edit_plan).toBe(true);

    await db.exec(`set request.jwt.claim.sub='${editor}'`);
    await db.query(`select set_nightly_destinations('${trip}','2026-11-01','2026-11-01','Tokyo')`);
    await db.query(`select delete_nightly_destination('${trip}','2026-11-01',1)`);
    const stay = (await db.query<{ id: string }>(`select (upsert_stay('${trip}','2026-11-01','2026-11-02','Hotel')).id id`)).rows[0].id;
    await db.query(`select delete_stay('${trip}','${stay}',1)`);
    const item = (await db.query<{ id: string }>(`select (upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Dinner',p_plan_date=>'2026-11-01')).id id`)).rows[0].id;
    await db.query(`select delete_itinerary_item('${trip}','${item}',1)`);
    await expect(db.query(`select create_invite('${trip}')`)).rejects.toThrow();
    await expect(db.query(`select remove_member('${editorMember}')`)).rejects.toThrow();
    await expect(db.query(`select archive_trip('${trip}')`)).rejects.toThrow(/organizer/i);
    await expect(db.query(`select set_trip_timezone('${trip}','Europe/Paris')`)).rejects.toThrow(/organizer/i);
    await expect(db.query(`select delete_trip('${trip}','Trip')`)).rejects.toThrow(/organizer/i);
    await expect(db.query(`select upsert_emergency_card('${trip}',p_emergency_contact_name=>'Nope')`)).rejects.toThrow(/organizer/i);
    await expect(db.query(`select set_member_plan_permission('${editorMember}',false)`)).rejects.toThrow();
    await db.exec(`set request.jwt.claim.sub='${organizer}'; select set_member_plan_permission('${editorMember}',false); set request.jwt.claim.sub='${editor}'`);
    await expect(db.query(`select set_nightly_destinations('${trip}','2026-11-02','2026-11-02','Revoked')`)).rejects.toThrow(/plan editor/i);

    await db.exec(`set request.jwt.claim.sub='${pendingUser}'`);
    await expect(db.query(`select upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Pending')`)).rejects.toThrow(/plan editor/i);
    await db.exec(`set request.jwt.claim.sub='${outsider}'`);
    await expect(db.query(`select set_nightly_destinations('${trip}','2026-11-01','2026-11-01','Nope')`)).rejects.toThrow(/plan editor/i);
    await db.exec(`set request.jwt.claim.sub='${otherTripUser}'`);
    await expect(db.query(`select upsert_stay('${trip}','2026-11-01','2026-11-02','Nope')`)).rejects.toThrow(/plan editor/i);
    await db.exec(`set role anon`);
    await expect(db.query(`select upsert_itinerary_item(p_trip_id=>'${trip}',p_title=>'Nope')`)).rejects.toThrow();
    await expect(db.query(`select set_member_plan_permission('${editorMember}',false)`)).rejects.toThrow();
    await db.exec("reset role");
    const allowed = await db.query<{ allowed: boolean }>(`select has_function_privilege('anon','public.set_member_plan_permission(uuid,boolean)','execute') allowed`);
    expect(allowed.rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>(`select has_function_privilege('anon','public.delete_itinerary_item(uuid,uuid,integer)','execute') allowed`)).rows[0].allowed).toBe(false);
  } finally {
    await db.close();
  }
}, 60000);
