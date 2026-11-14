-- Trip organizers may grant approved signed-in members permission to edit the shared plan.
alter table public.trip_members
  add column can_edit_plan boolean not null default false;

create function private.assert_plan_editor(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_trip_organizer(p_trip_id) or exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip_id
      and m.user_id = auth.uid()
      and m.status = 'approved'
      and m.role = 'member'
      and m.can_edit_plan
  )) then
    raise exception 'Plan editor access required' using errcode = '42501';
  end if;
end;
$$;

create function public.set_member_plan_permission(p_member_id uuid, p_can_edit boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_member public.trip_members;
begin
  select * into v_member from public.trip_members where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = '22023'; end if;
  perform private.assert_organizer(v_member.trip_id);
  perform private.assert_active_trip(v_member.trip_id);
  if v_member.role = 'organizer' then raise exception 'Organizer permission is not configurable'; end if;
  if v_member.status <> 'approved' or v_member.user_id is null or v_member.managed_by_user_id is not null then
    raise exception 'Only approved signed-in members can edit the plan' using errcode = '22023';
  end if;
  if p_can_edit is null then raise exception 'Permission value is required'; end if;
  update public.trip_members set can_edit_plan = p_can_edit where id = p_member_id;
end;
$$;

-- Planning writes: retain active-trip checks and optimistic versions.
create or replace function public.set_nightly_destinations(p_trip_id uuid,p_start_date date,p_end_date date,p_city text,p_transport_mode text default null,p_replace boolean default false,p_expected_versions jsonb default '{}'::jsonb)
returns setof public.nightly_destinations language plpgsql security definer set search_path='' as $$
declare v_count integer; v_expected_count integer;
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 perform private.assert_trip_dates(p_trip_id,p_start_date,p_end_date);
 if p_end_date-p_start_date>3650 then raise exception 'Range is too long'; end if;
 if jsonb_typeof(p_expected_versions) is distinct from 'object' then raise exception 'Invalid expected versions'; end if;
 select count(*) into v_count from public.nightly_destinations where trip_id=p_trip_id and night_date between p_start_date and p_end_date;
 select count(*) into v_expected_count from jsonb_each(p_expected_versions);
 if not coalesce(p_replace,false) and v_count>0 then raise exception 'Nights already planned; confirm replacement' using errcode='40001'; end if;
 if p_replace then
   if v_count<>v_expected_count or exists(select 1 from public.nightly_destinations n where n.trip_id=p_trip_id and n.night_date between p_start_date and p_end_date and (p_expected_versions->>n.night_date::text) is distinct from n.version::text)
   or exists(select 1 from jsonb_each(p_expected_versions) e where not exists(select 1 from public.nightly_destinations n where n.trip_id=p_trip_id and n.night_date=e.key::date and n.night_date between p_start_date and p_end_date and n.version::text=e.value#>>'{}')) then
    raise exception 'Night changed; refresh before replacing' using errcode='40001'; end if;
 elsif v_expected_count>0 then raise exception 'Unexpected expected versions'; end if;
 insert into public.nightly_destinations(trip_id,night_date,city,transport_mode)
 select p_trip_id,p_start_date+n,btrim(p_city),p_transport_mode from generate_series(0,p_end_date-p_start_date) n
 on conflict(trip_id,night_date) do update set city=excluded.city,transport_mode=excluded.transport_mode,version=nightly_destinations.version+1;
 return query select * from public.nightly_destinations where trip_id=p_trip_id and night_date between p_start_date and p_end_date order by night_date;
end; $$;

create or replace function public.delete_nightly_destination(p_trip_id uuid,p_night_date date,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 delete from public.nightly_destinations where trip_id=p_trip_id and night_date=p_night_date and version=p_expected_version;
 if not found then raise exception 'Night changed; refresh before deleting' using errcode='40001'; end if;
end; $$;

create or replace function public.upsert_stay(p_trip_id uuid,p_check_in_date date,p_check_out_date date,p_name text,p_address text default null,p_phone text default null,p_stay_id uuid default null,p_expected_version integer default null)
returns public.stays language plpgsql security definer set search_path='' as $$
declare v_stay public.stays;
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 perform private.assert_trip_dates(p_trip_id,p_check_in_date,p_check_out_date,true);
 if exists(select 1 from public.stays where trip_id=p_trip_id and id is distinct from p_stay_id and check_in_date<p_check_out_date and check_out_date>p_check_in_date) then raise exception 'Accommodation dates overlap' using errcode='22023'; end if;
 if p_stay_id is null then
  insert into public.stays(trip_id,check_in_date,check_out_date,name,address,phone) values(p_trip_id,p_check_in_date,p_check_out_date,btrim(p_name),p_address,p_phone) returning * into v_stay;
 else
  update public.stays set check_in_date=p_check_in_date,check_out_date=p_check_out_date,name=btrim(p_name),address=p_address,phone=p_phone,version=version+1 where trip_id=p_trip_id and id=p_stay_id and version=p_expected_version returning * into v_stay;
  if not found then raise exception 'Stay changed; refresh before saving' using errcode='40001'; end if;
 end if;
 return v_stay;
end; $$;

create or replace function public.delete_stay(p_trip_id uuid,p_stay_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 delete from public.stays where trip_id=p_trip_id and id=p_stay_id and version=p_expected_version;
 if not found then raise exception 'Stay changed; refresh before deleting' using errcode='40001'; end if;
end; $$;

-- The private base itinerary writer is reached only from the versioned public wrapper.
create or replace function private.upsert_itinerary_item(p_trip_id uuid,p_title text,p_starts_at timestamptz default null,p_address text default null,p_latitude double precision default null,p_longitude double precision default null,p_meeting_info text default null,p_notes text default null,p_position integer default 0,p_transport_mode text default null,p_item_id uuid default null,p_expected_version integer default null)
returns public.itinerary_items language plpgsql security definer set search_path='' as $$
declare v_item public.itinerary_items;
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 if p_item_id is null then
  insert into public.itinerary_items(trip_id,title,starts_at,address,latitude,longitude,meeting_info,notes,position,transport_mode) values(p_trip_id,btrim(p_title),p_starts_at,p_address,p_latitude,p_longitude,p_meeting_info,p_notes,coalesce(p_position,0),p_transport_mode) returning * into v_item;
 else
  update public.itinerary_items set title=btrim(p_title),starts_at=p_starts_at,address=p_address,latitude=p_latitude,longitude=p_longitude,meeting_info=p_meeting_info,notes=p_notes,position=coalesce(p_position,0),transport_mode=p_transport_mode,version=version+1,updated_at=now() where trip_id=p_trip_id and id=p_item_id and version=p_expected_version returning * into v_item;
  if not found then raise exception 'Item missing or version conflict' using errcode='40001'; end if;
 end if;
 return v_item;
end; $$;

create or replace function public.upsert_itinerary_item(p_trip_id uuid,p_title text,p_starts_at timestamptz default null,p_address text default null,p_latitude double precision default null,p_longitude double precision default null,p_meeting_info text default null,p_notes text default null,p_position integer default 0,p_transport_mode text default null,p_item_id uuid default null,p_expected_version integer default null,p_plan_date date default null)
returns public.itinerary_items language plpgsql security definer set search_path='' as $$
declare v_item public.itinerary_items; v_date date; v_zone text;
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 select timezone into v_zone from public.trips where id=p_trip_id;
 v_date:=coalesce(p_plan_date,(p_starts_at at time zone v_zone)::date);
 if v_date is not null then perform private.assert_trip_dates(p_trip_id,v_date,v_date); end if;
 v_item:=private.upsert_itinerary_item(p_trip_id,p_title,p_starts_at,p_address,p_latitude,p_longitude,p_meeting_info,p_notes,p_position,p_transport_mode,p_item_id,p_expected_version);
 update public.itinerary_items set plan_date=v_date where id=v_item.id returning * into v_item;
 return v_item;
end; $$;

create or replace function public.delete_itinerary_item(p_trip_id uuid,p_item_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_plan_editor(p_trip_id); perform private.assert_active_trip(p_trip_id);
 delete from public.itinerary_items where trip_id=p_trip_id and id=p_item_id and version=p_expected_version;
 if not found then raise exception 'Item missing or version conflict' using errcode='40001'; end if;
end; $$;

revoke execute on function public.set_member_plan_permission(uuid,boolean), private.assert_plan_editor(uuid) from public,anon,authenticated;
revoke execute on function public.set_nightly_destinations(uuid,date,date,text,text,boolean,jsonb),public.delete_nightly_destination(uuid,date,integer),public.upsert_stay(uuid,date,date,text,text,text,uuid,integer),public.delete_stay(uuid,uuid,integer),public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer,date),public.delete_itinerary_item(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.set_member_plan_permission(uuid,boolean),public.set_nightly_destinations(uuid,date,date,text,text,boolean,jsonb),public.delete_nightly_destination(uuid,date,integer),public.upsert_stay(uuid,date,date,text,text,text,uuid,integer),public.delete_stay(uuid,uuid,integer),public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer,date),public.delete_itinerary_item(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
