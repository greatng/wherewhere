-- Apply after 001 and 002. Existing installations and financial records are preserved.
create table public.nightly_destinations (
 trip_id uuid not null references public.trips(id) on delete cascade,
 night_date date not null, city text not null check(char_length(btrim(city)) between 1 and 160),
 transport_mode text check(transport_mode in ('walk','car','taxi','bus','train','boat','flight','other')),
 version integer not null default 1, primary key(trip_id,night_date)
);
create table public.stays (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
 check_in_date date not null, check_out_date date not null check(check_out_date>check_in_date),
 name text not null check(char_length(btrim(name)) between 1 and 160), address text check(char_length(address)<=500),
 phone text check(char_length(phone)<=40), version integer not null default 1
);
create index on public.stays(trip_id,check_in_date);
alter table public.nightly_destinations enable row level security;
alter table public.stays enable row level security;
create policy nights_read on public.nightly_destinations for select to authenticated using(public.is_trip_member(trip_id));
create policy stays_read on public.stays for select to authenticated using(public.is_trip_member(trip_id));
revoke all on public.nightly_destinations,public.stays from anon,authenticated;
grant select on public.nightly_destinations,public.stays to authenticated;

-- A shared trip-row lock serializes lifecycle transitions and active-trip writes.
create or replace function private.assert_active_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.trips where id=p_trip_id and status='active' for update;
 if not found then raise exception 'Trip is archived or missing' using errcode='22023'; end if;
end; $$;
create function private.assert_trip_dates(p_trip_id uuid,p_start date,p_end date,p_checkout boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_start is null or p_end is null or p_end<p_start or not exists(
   select 1 from public.trips where id=p_trip_id and p_start>=start_date and p_end<=end_date+case when p_checkout then 1 else 0 end
 ) then raise exception 'Dates must be within the trip' using errcode='22023'; end if;
end; $$;
create function public.set_nightly_destinations(p_trip_id uuid,p_start_date date,p_end_date date,p_city text,p_transport_mode text default null,p_replace boolean default false,p_expected_versions jsonb default '{}'::jsonb)
returns setof public.nightly_destinations language plpgsql security definer set search_path='' as $$
declare v_count integer; v_expected_count integer;
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 perform private.assert_trip_dates(p_trip_id,p_start_date,p_end_date);
 if p_end_date-p_start_date>3650 then raise exception 'Range is too long'; end if;
 if jsonb_typeof(p_expected_versions) is distinct from 'object' then raise exception 'Invalid expected versions'; end if;
 select count(*) into v_count from public.nightly_destinations where trip_id=p_trip_id and night_date between p_start_date and p_end_date;
 select count(*) into v_expected_count from jsonb_each(p_expected_versions);
 if not coalesce(p_replace,false) and v_count>0 then
   raise exception 'Nights already planned; confirm replacement' using errcode='40001';
 end if;
 if p_replace then
   if v_count<>v_expected_count or exists(
     select 1 from public.nightly_destinations n where n.trip_id=p_trip_id and n.night_date between p_start_date and p_end_date
       and (p_expected_versions->>n.night_date::text) is distinct from n.version::text
   ) or exists(
     select 1 from jsonb_each(p_expected_versions) e where not exists(
       select 1 from public.nightly_destinations n where n.trip_id=p_trip_id and n.night_date=e.key::date
         and n.night_date between p_start_date and p_end_date and n.version::text=e.value#>>'{}'
     )
   ) then raise exception 'Night changed; refresh before replacing' using errcode='40001'; end if;
 elsif v_expected_count>0 then
   raise exception 'Unexpected expected versions';
 end if;
 insert into public.nightly_destinations(trip_id,night_date,city,transport_mode)
 select p_trip_id,p_start_date+n,btrim(p_city),p_transport_mode from generate_series(0,p_end_date-p_start_date) n
 on conflict(trip_id,night_date) do update set city=excluded.city,transport_mode=excluded.transport_mode,version=nightly_destinations.version+1;
 return query select * from public.nightly_destinations where trip_id=p_trip_id and night_date between p_start_date and p_end_date order by night_date;
end; $$;
create function public.delete_nightly_destination(p_trip_id uuid,p_night_date date,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 delete from public.nightly_destinations where trip_id=p_trip_id and night_date=p_night_date and version=p_expected_version;
 if not found then raise exception 'Night changed; refresh before deleting' using errcode='40001'; end if;
end; $$;
create function public.upsert_stay(p_trip_id uuid,p_check_in_date date,p_check_out_date date,p_name text,p_address text default null,p_phone text default null,p_stay_id uuid default null,p_expected_version integer default null)
returns public.stays language plpgsql security definer set search_path='' as $$
declare v_stay public.stays;
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 perform private.assert_trip_dates(p_trip_id,p_check_in_date,p_check_out_date,true);
 if exists(select 1 from public.stays where trip_id=p_trip_id and id is distinct from p_stay_id and check_in_date<p_check_out_date and check_out_date>p_check_in_date) then
  raise exception 'Accommodation dates overlap' using errcode='22023'; end if;
 if p_stay_id is null then
  insert into public.stays(trip_id,check_in_date,check_out_date,name,address,phone) values(p_trip_id,p_check_in_date,p_check_out_date,btrim(p_name),p_address,p_phone) returning * into v_stay;
 else
  update public.stays set check_in_date=p_check_in_date,check_out_date=p_check_out_date,name=btrim(p_name),address=p_address,phone=p_phone,version=version+1
  where trip_id=p_trip_id and id=p_stay_id and version=p_expected_version returning * into v_stay;
  if not found then raise exception 'Stay changed; refresh before saving' using errcode='40001'; end if;
 end if;
 return v_stay;
end; $$;
create function public.delete_stay(p_trip_id uuid,p_stay_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 delete from public.stays where trip_id=p_trip_id and id=p_stay_id and version=p_expected_version;
 if not found then raise exception 'Stay changed; refresh before deleting' using errcode='40001'; end if;
end; $$;

alter table public.itinerary_items add column plan_date date;
update public.itinerary_items i set plan_date=(i.starts_at at time zone t.timezone)::date from public.trips t where t.id=i.trip_id and i.starts_at is not null;
alter table public.itinerary_items drop constraint itinerary_items_transport_mode_check;
alter table public.itinerary_items add constraint itinerary_items_transport_mode_check check(transport_mode in ('walk','car','taxi','bus','train','boat','flight','other'));
alter function public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer) set schema private;
create function public.upsert_itinerary_item(p_trip_id uuid,p_title text,p_starts_at timestamptz default null,p_address text default null,p_latitude double precision default null,p_longitude double precision default null,p_meeting_info text default null,p_notes text default null,p_position integer default 0,p_transport_mode text default null,p_item_id uuid default null,p_expected_version integer default null,p_plan_date date default null)
returns public.itinerary_items language plpgsql security definer set search_path='' as $$
declare v_item public.itinerary_items; v_date date; v_zone text;
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 select timezone into v_zone from public.trips where id=p_trip_id;
 v_date:=coalesce(p_plan_date,(p_starts_at at time zone v_zone)::date);
 if v_date is not null then perform private.assert_trip_dates(p_trip_id,v_date,v_date); end if;
 if p_plan_date is not null and p_starts_at is not null and p_plan_date<>(p_starts_at at time zone v_zone)::date then raise exception 'Activity time must match the planned day'; end if;
 v_item:=private.upsert_itinerary_item(p_trip_id,p_title,p_starts_at,p_address,p_latitude,p_longitude,p_meeting_info,p_notes,p_position,p_transport_mode,p_item_id,p_expected_version);
 update public.itinerary_items set plan_date=v_date where id=v_item.id returning * into v_item;
 return v_item;
end; $$;

alter table public.expenses add column expense_date date, add column expense_time time, add column occurrence_timezone text;
alter table public.expenses add constraint expense_time_requires_date check(expense_time is null or expense_date is not null);
alter function public.create_expense(uuid,uuid,text,text,text,jsonb,uuid) set schema private;
create function public.create_expense(p_trip_id uuid,p_payer_member_id uuid,p_amount_minor text,p_currency text,p_description text,p_shares jsonb,p_operation_id uuid,p_expense_date date default null,p_expense_time time default null)
returns public.expenses language plpgsql security definer set search_path='' as $$
declare v_expense public.expenses; v_existing public.expenses;
begin
 perform public.assert_member_row(p_trip_id,p_payer_member_id); perform private.assert_active_trip(p_trip_id);
 if p_expense_time is not null and p_expense_date is null then raise exception 'Expense time requires date'; end if;
 select * into v_existing from public.expenses where trip_id=p_trip_id and client_operation_id=p_operation_id;
 if found and (v_existing.expense_date is distinct from p_expense_date or v_existing.expense_time is distinct from p_expense_time) then raise exception 'Operation ID payload mismatch' using errcode='22023'; end if;
 v_expense:=private.create_expense(p_trip_id,p_payer_member_id,p_amount_minor,p_currency,p_description,p_shares,p_operation_id);
 if v_existing.id is null then
  update public.expenses set expense_date=p_expense_date,expense_time=p_expense_time,occurrence_timezone=(select timezone from public.trips where id=p_trip_id) where id=v_expense.id returning * into v_expense;
 end if;
 return v_expense;
end; $$;

create table public.expense_revisions (
 id uuid primary key default gen_random_uuid(),trip_id uuid not null references public.trips(id) on delete cascade,
 expense_id uuid not null, changed_by uuid not null references auth.users(id), changed_at timestamptz not null default now(),
 previous_version integer not null, previous_values jsonb not null, result_values jsonb, operation_id uuid not null, request_payload jsonb not null,
 unique(trip_id,operation_id), foreign key(trip_id,expense_id) references public.expenses(trip_id,id) on delete cascade
);
alter table public.expense_revisions enable row level security;
create policy revisions_read on public.expense_revisions for select to authenticated using(public.is_trip_member(trip_id));
revoke all on public.expense_revisions from anon,authenticated;
grant select on public.expense_revisions to authenticated;
create function public.correct_expense(p_trip_id uuid,p_expense_id uuid,p_expected_version integer,p_payer_member_id uuid,p_amount_minor text,p_currency text,p_description text,p_shares jsonb,p_operation_id uuid,p_expense_date date default null,p_expense_time time default null)
returns public.expenses language plpgsql security definer set search_path='' as $$
declare v_old public.expenses; v_new public.expenses; v_revision public.expense_revisions; v_payload jsonb; v_share jsonb; v_sum numeric:=0; v_count integer:=0; v_amount bigint;
begin
 perform private.assert_organizer(p_trip_id); perform private.assert_active_trip(p_trip_id);
 perform public.assert_member_row(p_trip_id,p_payer_member_id);
 if p_operation_id is null or p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]*$' then raise exception 'Positive integer amount and operation ID required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || p_operation_id::text,0));
 v_amount:=p_amount_minor::bigint;
 if p_currency is distinct from (select base_currency from public.trips where id=p_trip_id) then raise exception 'Expense currency must match trip base currency'; end if;
 if p_expense_time is not null and p_expense_date is null then raise exception 'Expense time requires date'; end if;
 if jsonb_typeof(p_shares) is distinct from 'array' then raise exception 'Invalid shares'; end if;
 for v_share in select value from jsonb_array_elements(p_shares) loop
  if v_share->>'member_id' is null or v_share->>'owed_minor' is null or (v_share->>'owed_minor') !~ '^[0-9]+$' then raise exception 'Invalid share'; end if;
  perform public.assert_member_row(p_trip_id,(v_share->>'member_id')::uuid);
  v_sum:=v_sum+(v_share->>'owed_minor')::bigint; v_count:=v_count+1;
 end loop;
 if v_count=0 or v_sum<>v_amount then raise exception 'Shares must equal expense amount'; end if;
 v_payload:=jsonb_build_object('expense',p_expense_id,'version',p_expected_version,'payer',p_payer_member_id,'amount',p_amount_minor,'currency',p_currency,'description',btrim(p_description),'shares',p_shares,'date',p_expense_date,'time',p_expense_time);
 select * into v_revision from public.expense_revisions where trip_id=p_trip_id and operation_id=p_operation_id;
 if found then
  if v_revision.request_payload is distinct from v_payload then raise exception 'Operation ID payload mismatch'; end if;
  select * into v_new from jsonb_populate_record(null::public.expenses,v_revision.result_values->'expense');
  return v_new;
 end if;
 select * into v_old from public.expenses where trip_id=p_trip_id and id=p_expense_id for update;
 if not found or v_old.version is distinct from p_expected_version then raise exception 'Expense changed; refresh before correcting' using errcode='40001'; end if;
 insert into public.expense_revisions(trip_id,expense_id,changed_by,previous_version,previous_values,operation_id,request_payload)
 values(p_trip_id,p_expense_id,auth.uid(),v_old.version,jsonb_build_object('expense',to_jsonb(v_old)||jsonb_build_object('amount_minor',v_old.amount_minor::text),'shares',(select jsonb_agg(jsonb_build_object('trip_member_id',trip_member_id,'owed_minor',owed_minor::text)) from public.expense_shares where trip_id=p_trip_id and expense_id=p_expense_id)),p_operation_id,v_payload);
 delete from public.expense_shares where trip_id=p_trip_id and expense_id=p_expense_id;
 insert into public.expense_shares(trip_id,expense_id,trip_member_id,owed_minor)
 select p_trip_id,p_expense_id,(x->>'member_id')::uuid,(x->>'owed_minor')::bigint from jsonb_array_elements(p_shares) x;
 update public.expenses set paid_by_member_id=p_payer_member_id,amount_minor=v_amount,currency=p_currency,description=btrim(p_description),expense_date=p_expense_date,expense_time=p_expense_time,occurrence_timezone=(select timezone from public.trips where id=p_trip_id),version=version+1
 where id=p_expense_id returning * into v_new;
 update public.expense_revisions set result_values=jsonb_build_object('expense',to_jsonb(v_new)) where trip_id=p_trip_id and operation_id=p_operation_id;
 return v_new;
end; $$;

create function public.restore_trip(p_trip_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform private.assert_organizer(p_trip_id); update public.trips set status='active' where id=p_trip_id; end; $$;
create function public.delete_trip(p_trip_id uuid,p_confirmation_title text) returns void language plpgsql security definer set search_path='' as $$
declare v_title text;
begin
 perform private.assert_organizer(p_trip_id);
 select title into v_title from public.trips where id=p_trip_id for update;
 if p_confirmation_title is distinct from v_title then raise exception 'Type the exact trip name to delete'; end if;
 delete from public.expense_revisions where trip_id=p_trip_id;
 delete from public.expense_shares where trip_id=p_trip_id;
 delete from public.expenses where trip_id=p_trip_id;
 delete from public.settlements where trip_id=p_trip_id;
 delete from public.check_ins where trip_id=p_trip_id;
 delete from public.itinerary_items where trip_id=p_trip_id;
 delete from public.trip_join_requests where trip_id=p_trip_id;
 delete from public.trip_invites where trip_id=p_trip_id;
 delete from public.trip_members where trip_id=p_trip_id;
 delete from public.trips where id=p_trip_id;
end; $$;

revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.set_nightly_destinations(uuid,date,date,text,text,boolean,jsonb),public.delete_nightly_destination(uuid,date,integer),public.upsert_stay(uuid,date,date,text,text,text,uuid,integer),public.delete_stay(uuid,uuid,integer),public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer,date),public.create_expense(uuid,uuid,text,text,text,jsonb,uuid,date,time),public.correct_expense(uuid,uuid,integer,uuid,text,text,text,jsonb,uuid,date,time),public.restore_trip(uuid),public.delete_trip(uuid,text) from public,anon,authenticated;
grant execute on function public.set_nightly_destinations(uuid,date,date,text,text,boolean,jsonb),public.delete_nightly_destination(uuid,date,integer),public.upsert_stay(uuid,date,date,text,text,text,uuid,integer),public.delete_stay(uuid,uuid,integer),public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer,date),public.create_expense(uuid,uuid,text,text,text,jsonb,uuid,date,time),public.correct_expense(uuid,uuid,integer,uuid,text,text,text,jsonb,uuid,date,time),public.restore_trip(uuid),public.delete_trip(uuid,text) to authenticated;
notify pgrst,'reload schema';
