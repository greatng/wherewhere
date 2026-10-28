-- M3/M4. Private trip data is readable by approved members and mutated only
-- through transaction-sized RPCs that validate every referenced member/item.
create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  starts_at timestamptz,
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  meeting_info text,
  notes text,
  transport_mode text check (transport_mode is null or transport_mode in ('walk','car','taxi','bus','train','boat','other')),
  position integer not null default 0,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (trip_id, id)
);
create index itinerary_items_order on public.itinerary_items(trip_id, starts_at, position);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_member_id uuid not null,
  itinerary_item_id uuid not null,
  checked_in_at timestamptz not null default now(),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  client_operation_id uuid not null,
  unique (trip_id, id),
  unique (trip_id, client_operation_id),
  foreign key (trip_id, trip_member_id) references public.trip_members(trip_id, id),
  foreign key (trip_id, itinerary_item_id) references public.itinerary_items(trip_id, id),
  check ((latitude is null) = (longitude is null))
);
create index check_ins_item_time on public.check_ins(trip_id, itinerary_item_id, checked_in_at desc);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  paid_by_member_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  description text not null check (char_length(btrim(description)) between 1 and 240),
  version integer not null default 1 check (version > 0),
  client_operation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (trip_id, id),
  unique (trip_id, client_operation_id),
  foreign key (trip_id, paid_by_member_id) references public.trip_members(trip_id, id)
);
create index expenses_time on public.expenses(trip_id, created_at desc);

create table public.expense_shares (
  trip_id uuid not null,
  expense_id uuid not null,
  trip_member_id uuid not null,
  owed_minor bigint not null check (owed_minor >= 0),
  primary key (trip_id, expense_id, trip_member_id),
  foreign key (trip_id, expense_id) references public.expenses(trip_id, id) on delete cascade,
  foreign key (trip_id, trip_member_id) references public.trip_members(trip_id, id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_member_id uuid not null,
  to_member_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  client_operation_id uuid not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (trip_id, id),
  unique (trip_id, client_operation_id),
  foreign key (trip_id, from_member_id) references public.trip_members(trip_id, id),
  foreign key (trip_id, to_member_id) references public.trip_members(trip_id, id),
  check (from_member_id <> to_member_id)
);
create index settlements_time on public.settlements(trip_id, created_at desc);

create table public.emergency_cards (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  hotel_name text,
  hotel_address text,
  hotel_phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  updated_at timestamptz not null default now(),
  check (hotel_name is null or char_length(hotel_name) <= 160),
  check (hotel_address is null or char_length(hotel_address) <= 500),
  check (hotel_phone is null or char_length(hotel_phone) <= 40),
  check (emergency_contact_name is null or char_length(emergency_contact_name) <= 120),
  check (emergency_contact_phone is null or char_length(emergency_contact_phone) <= 40)
);

alter table public.itinerary_items enable row level security;
alter table public.check_ins enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;
alter table public.emergency_cards enable row level security;
create policy itinerary_read on public.itinerary_items for select to authenticated using (public.is_trip_member(trip_id));
create policy checkins_read on public.check_ins for select to authenticated using (public.is_trip_member(trip_id));
create policy expenses_read on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
create policy shares_read on public.expense_shares for select to authenticated using (public.is_trip_member(trip_id));
create policy settlements_read on public.settlements for select to authenticated using (public.is_trip_member(trip_id));
create policy emergency_cards_read on public.emergency_cards for select to authenticated using (public.is_trip_member(trip_id));

create function public.assert_member_row(p_trip_id uuid, p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'Trip membership required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.id=p_member_id and m.status='approved') then
    raise exception 'Member is not active in trip' using errcode = '22023';
  end if;
end;
$$;

create function private.assert_active_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.trips where id=p_trip_id and status='active') then
    raise exception 'Trip is archived or missing' using errcode='22023';
  end if;
end;
$$;

create function public.upsert_itinerary_item(
  p_trip_id uuid, p_title text, p_starts_at timestamptz default null,
  p_address text default null, p_latitude double precision default null,
  p_longitude double precision default null, p_meeting_info text default null,
  p_notes text default null, p_position integer default 0,
  p_transport_mode text default null, p_item_id uuid default null,
  p_expected_version integer default null
) returns public.itinerary_items
language plpgsql security definer set search_path = '' as $$
declare v_item public.itinerary_items;
begin
  perform private.assert_organizer(p_trip_id);
  perform private.assert_active_trip(p_trip_id);
  if p_item_id is null then
    insert into public.itinerary_items(trip_id,title,starts_at,address,latitude,longitude,meeting_info,notes,position,transport_mode)
      values(p_trip_id,btrim(p_title),p_starts_at,p_address,p_latitude,p_longitude,p_meeting_info,p_notes,coalesce(p_position,0),p_transport_mode)
      returning * into v_item;
  else
    update public.itinerary_items set title=btrim(p_title),starts_at=p_starts_at,address=p_address,
      latitude=p_latitude,longitude=p_longitude,meeting_info=p_meeting_info,notes=p_notes,
      position=coalesce(p_position,0),transport_mode=p_transport_mode,version=version+1,updated_at=now()
      where trip_id=p_trip_id and id=p_item_id and version=p_expected_version returning * into v_item;
    if not found then raise exception 'Item missing or version conflict' using errcode='40001'; end if;
  end if;
  return v_item;
end;
$$;

create function public.delete_itinerary_item(p_trip_id uuid,p_item_id uuid,p_expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_organizer(p_trip_id);
  perform private.assert_active_trip(p_trip_id);
  delete from public.itinerary_items where trip_id=p_trip_id and id=p_item_id and version=p_expected_version;
  if not found then raise exception 'Item missing or version conflict' using errcode='40001'; end if;
end;
$$;

create function public.check_in(p_trip_id uuid,p_member_id uuid,p_item_id uuid,p_operation_id uuid,
  p_latitude double precision default null,p_longitude double precision default null) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare v_check public.check_ins; v_member public.trip_members;
begin
  perform public.assert_member_row(p_trip_id,p_member_id);
  perform private.assert_active_trip(p_trip_id);
  select * into v_member from public.trip_members where trip_id=p_trip_id and id=p_member_id;
  if v_member.user_id is distinct from auth.uid() and
     not (v_member.user_id is null and public.is_trip_organizer(p_trip_id)) then
    raise exception 'Cannot check in another device member' using errcode='42501';
  end if;
  if p_latitude is not null or p_longitude is not null then
    raise exception 'Location check-in is unavailable without explicit location consent' using errcode='22023';
  end if;
  if p_operation_id is null then raise exception 'Operation ID required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || p_operation_id::text,0));
  select * into v_check from public.check_ins where trip_id=p_trip_id and client_operation_id=p_operation_id;
  if found then
    if v_check.trip_member_id<>p_member_id or v_check.itinerary_item_id<>p_item_id or
       v_check.latitude is distinct from p_latitude or v_check.longitude is distinct from p_longitude then
      raise exception 'Operation ID payload mismatch' using errcode='22023';
    end if;
    return v_check;
  end if;
  insert into public.check_ins(trip_id,trip_member_id,itinerary_item_id,client_operation_id,latitude,longitude)
    values(p_trip_id,p_member_id,p_item_id,p_operation_id,p_latitude,p_longitude) returning * into v_check;
  return v_check;
end;
$$;

create function public.create_expense(p_trip_id uuid,p_payer_member_id uuid,p_amount_minor text,
  p_currency text,p_description text,p_shares jsonb,p_operation_id uuid) returns public.expenses
language plpgsql security definer set search_path = '' as $$
declare v_expense public.expenses; v_share jsonb; v_sum numeric := 0; v_count integer := 0; v_amount bigint; v_currency text;
begin
  perform public.assert_member_row(p_trip_id,p_payer_member_id);
  perform private.assert_active_trip(p_trip_id);
  if p_operation_id is null or p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]*$' then raise exception 'Amount must be a positive integer string'; end if;
  v_amount := p_amount_minor::bigint;
  select base_currency into v_currency from public.trips where id=p_trip_id;
  if p_currency is distinct from v_currency then raise exception 'Expense currency must match trip base currency'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || p_operation_id::text,0));
  select * into v_expense from public.expenses where trip_id=p_trip_id and client_operation_id=p_operation_id;
  if found then
    if v_expense.paid_by_member_id is distinct from p_payer_member_id or v_expense.amount_minor is distinct from v_amount or
       v_expense.currency is distinct from p_currency or v_expense.description is distinct from btrim(p_description) or
       (select coalesce(jsonb_agg(jsonb_build_object('member_id',s.trip_member_id,'owed_minor',s.owed_minor) order by s.trip_member_id), '[]'::jsonb)
          from public.expense_shares s where s.trip_id=p_trip_id and s.expense_id=v_expense.id)
       is distinct from
       (select coalesce(jsonb_agg(jsonb_build_object('member_id',(x->>'member_id')::uuid,'owed_minor',(x->>'owed_minor')::bigint) order by (x->>'member_id')::uuid), '[]'::jsonb)
          from jsonb_array_elements(coalesce(p_shares,'[]'::jsonb)) x) then
      raise exception 'Operation ID payload mismatch' using errcode='22023';
    end if;
    return v_expense;
  end if;
  if jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Invalid expense';
  end if;
  for v_share in select value from jsonb_array_elements(p_shares) loop
    if (v_share->>'member_id') is null or (v_share->>'owed_minor') !~ '^[0-9]+$' then raise exception 'Invalid share'; end if;
    perform public.assert_member_row(p_trip_id,(v_share->>'member_id')::uuid);
    v_sum := v_sum + (v_share->>'owed_minor')::bigint;
    v_count := v_count + 1;
  end loop;
  if v_count=0 or v_sum <> v_amount then raise exception 'Shares must equal expense amount'; end if;
  insert into public.expenses(trip_id,paid_by_member_id,amount_minor,currency,description,client_operation_id)
    values(p_trip_id,p_payer_member_id,v_amount,p_currency,btrim(p_description),p_operation_id) returning * into v_expense;
  insert into public.expense_shares(trip_id,expense_id,trip_member_id,owed_minor)
    select p_trip_id,v_expense.id,(x->>'member_id')::uuid,(x->>'owed_minor')::bigint from jsonb_array_elements(p_shares) x;
  return v_expense;
end;
$$;

create function public.record_settlement(p_trip_id uuid,p_from_member_id uuid,p_to_member_id uuid,
  p_amount_minor text,p_operation_id uuid) returns public.settlements
language plpgsql security definer set search_path = '' as $$
declare v_settlement public.settlements; v_amount bigint;
begin
  perform public.assert_member_row(p_trip_id,p_from_member_id);
  perform public.assert_member_row(p_trip_id,p_to_member_id);
  perform private.assert_active_trip(p_trip_id);
  if p_amount_minor is null or p_amount_minor !~ '^[1-9][0-9]*$' or p_operation_id is null then raise exception 'Settlement amount must be a positive integer string'; end if;
  v_amount := p_amount_minor::bigint;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trip_id::text || p_operation_id::text,0));
  select * into v_settlement from public.settlements where trip_id=p_trip_id and client_operation_id=p_operation_id;
  if found then
    if v_settlement.from_member_id is distinct from p_from_member_id or v_settlement.to_member_id is distinct from p_to_member_id or v_settlement.amount_minor is distinct from v_amount then
      raise exception 'Operation ID payload mismatch' using errcode='22023';
    end if;
    return v_settlement;
  end if;
  insert into public.settlements(trip_id,from_member_id,to_member_id,amount_minor,client_operation_id)
    values(p_trip_id,p_from_member_id,p_to_member_id,v_amount,p_operation_id) returning * into v_settlement;
  return v_settlement;
end;
$$;

create function public.upsert_emergency_card(p_trip_id uuid,p_hotel_name text default null,
  p_hotel_address text default null,p_hotel_phone text default null,
  p_emergency_contact_name text default null,p_emergency_contact_phone text default null)
returns public.emergency_cards
language plpgsql security definer set search_path = '' as $$
declare v_card public.emergency_cards;
begin
  perform private.assert_organizer(p_trip_id);
  perform private.assert_active_trip(p_trip_id);
  insert into public.emergency_cards(trip_id,hotel_name,hotel_address,hotel_phone,emergency_contact_name,emergency_contact_phone)
    values(p_trip_id,nullif(btrim(p_hotel_name),''),nullif(btrim(p_hotel_address),''),nullif(btrim(p_hotel_phone),''),
      nullif(btrim(p_emergency_contact_name),''),nullif(btrim(p_emergency_contact_phone),''))
    on conflict (trip_id) do update set hotel_name=excluded.hotel_name,hotel_address=excluded.hotel_address,
      hotel_phone=excluded.hotel_phone,emergency_contact_name=excluded.emergency_contact_name,
      emergency_contact_phone=excluded.emergency_contact_phone,updated_at=now()
    returning * into v_card;
  return v_card;
end;
$$;

create function public.confirm_settlement(p_trip_id uuid,p_settlement_id uuid) returns public.settlements
language plpgsql security definer set search_path = '' as $$
declare v_settlement public.settlements; v_actor public.trip_members;
begin
  if not public.is_trip_member(p_trip_id) then raise exception 'Trip membership required' using errcode='42501'; end if;
  perform private.assert_active_trip(p_trip_id);
  select * into v_settlement from public.settlements where trip_id=p_trip_id and id=p_settlement_id for update;
  if not found then raise exception 'Settlement not found'; end if;
  select * into v_actor from public.trip_members where trip_id=p_trip_id and user_id=auth.uid() and status='approved' limit 1;
  if v_actor.role<>'organizer' and not exists(select 1 from public.trip_members m
      where m.trip_id=p_trip_id and m.id=v_settlement.to_member_id and
        (m.user_id=auth.uid() or m.managed_by_user_id=auth.uid())) then
    raise exception 'Only recipient or organizer may confirm settlement' using errcode='42501';
  end if;
  if v_settlement.status='cancelled' then raise exception 'Settlement is cancelled'; end if;
  if v_settlement.status='pending' then
    update public.settlements set status='confirmed',decided_at=now() where id=p_settlement_id returning * into v_settlement;
  end if;
  return v_settlement;
end;
$$;

create function public.trip_balances(p_trip_id uuid) returns table(trip_member_id uuid,net_minor text)
language sql stable security definer set search_path = '' as $$
  select m.id,
    (coalesce((select sum(e.amount_minor) from public.expenses e where e.trip_id=p_trip_id and e.paid_by_member_id=m.id),0)
      - coalesce((select sum(s.owed_minor) from public.expense_shares s where s.trip_id=p_trip_id and s.trip_member_id=m.id),0)
      + coalesce((select sum(x.amount_minor) from public.settlements x where x.trip_id=p_trip_id and x.from_member_id=m.id and x.status='confirmed'),0)
      - coalesce((select sum(x.amount_minor) from public.settlements x where x.trip_id=p_trip_id and x.to_member_id=m.id and x.status='confirmed'),0))::text
  from public.trip_members m
  where m.trip_id=p_trip_id and public.is_trip_member(p_trip_id)
  order by m.id;
$$;

revoke all on public.itinerary_items,public.check_ins,public.expenses,public.expense_shares,public.settlements,public.emergency_cards from anon,authenticated;
grant select on public.itinerary_items,public.check_ins,public.expenses,public.expense_shares,public.settlements,public.emergency_cards to authenticated;
revoke execute on function public.assert_member_row(uuid,uuid),
  public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer),
  public.delete_itinerary_item(uuid,uuid,integer),
  public.check_in(uuid,uuid,uuid,uuid,double precision,double precision),
  public.create_expense(uuid,uuid,text,text,text,jsonb,uuid),
  public.record_settlement(uuid,uuid,uuid,text,uuid),
  public.upsert_emergency_card(uuid,text,text,text,text,text),
  public.confirm_settlement(uuid,uuid),public.trip_balances(uuid)
from public,anon,authenticated;
grant execute on function public.is_trip_member(uuid), public.is_trip_organizer(uuid),
  public.upsert_itinerary_item(uuid,text,timestamptz,text,double precision,double precision,text,text,integer,text,uuid,integer),
  public.delete_itinerary_item(uuid,uuid,integer),
  public.check_in(uuid,uuid,uuid,uuid,double precision,double precision),
  public.create_expense(uuid,uuid,text,text,text,jsonb,uuid),
  public.record_settlement(uuid,uuid,uuid,text,uuid),
  public.upsert_emergency_card(uuid,text,text,text,text,text),
  public.confirm_settlement(uuid,uuid),public.trip_balances(uuid)
to authenticated;
