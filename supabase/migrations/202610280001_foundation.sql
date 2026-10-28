-- M1/M2 only. Transactional writes go through explicitly granted RPCs.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  title text not null check (char_length(title) between 1 and 120),
  timezone text not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  user_id uuid references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('organizer', 'member')),
  status text not null default 'approved' check (status in ('approved', 'removed')),
  managed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, user_id),
  unique (trip_id, id),
  check ((user_id is not null and managed_by_user_id is null) or
         (user_id is null and managed_by_user_id is not null and role = 'member'))
);
create index on public.trip_members(user_id, trip_id) where status = 'approved';

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 100),
  uses_count integer not null default 0 check (uses_count >= 0 and uses_count <= max_uses),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, id)
);

create table public.trip_join_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id),
  invite_id uuid not null,
  auth_user_id uuid not null references auth.users(id),
  requested_display_name text not null check (char_length(requested_display_name) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (trip_id, auth_user_id),
  foreign key (trip_id, invite_id) references public.trip_invites(trip_id, id)
);
create index on public.trip_join_requests(auth_user_id);

-- Fixed-window limiter, private and accessible only through the gateway RPC.
create table private.invite_attempts (
  rate_key text primary key,
  window_start timestamptz not null,
  attempts integer not null
);
alter table private.invite_attempts enable row level security;

create function public.is_trip_member(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid() and status = 'approved');
$$;
create function public.is_trip_organizer(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
      and status = 'approved' and role = 'organizer');
$$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.trip_join_requests enable row level security;
create policy trips_read on public.trips for select to authenticated
  using (public.is_trip_member(id));
create policy members_read on public.trip_members for select to authenticated
  using (public.is_trip_member(trip_id));
create policy invites_read on public.trip_invites for select to authenticated
  using (public.is_trip_organizer(trip_id));
create policy requests_read on public.trip_join_requests for select to authenticated
  using (auth_user_id = auth.uid() or public.is_trip_organizer(trip_id));

create function private.assert_organizer(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
end;
$$;

create function public.create_trip(p_title text, p_name text, p_timezone text,
  p_currency text, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid timezone';
  end if;
  insert into public.trips(owner_user_id, title, timezone, base_currency, start_date, end_date)
    values(auth.uid(), btrim(p_title), p_timezone, upper(p_currency), p_start, p_end) returning id into v_id;
  insert into public.trip_members(trip_id, user_id, display_name, role)
    values(v_id, auth.uid(), btrim(p_name), 'organizer');
  return v_id;
end;
$$;

create function public.archive_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_organizer(p_trip_id);
  update public.trips set status = 'archived' where id = p_trip_id;
  update public.trip_invites set revoked_at = now() where trip_id = p_trip_id and revoked_at is null;
end;
$$;

create function public.create_invite(p_trip_id uuid, p_hours integer default 24, p_max_uses integer default 8)
returns table(id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_id uuid;
begin
  perform private.assert_organizer(p_trip_id);
  if p_hours not between 1 and 168 or p_hours is null then raise exception 'Invalid expiry'; end if;
  if not exists(select 1 from public.trips where trips.id = p_trip_id and status = 'active') then
    raise exception 'Trip archived';
  end if;
  insert into public.trip_invites(trip_id, token_hash, expires_at, max_uses)
    values(p_trip_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
      now() + make_interval(hours => p_hours), p_max_uses) returning trip_invites.id into v_id;
  return query select v_id, v_token;
end;
$$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_trip uuid;
begin
  select trip_id into v_trip from public.trip_invites where id = p_invite_id;
  perform private.assert_organizer(v_trip);
  update public.trip_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite_id;
end;
$$;

-- service_role only: caller is the Edge Function, with verified user and hashed IP.
-- Validation precedes anonymous sign-in; redemption validates again under a row lock.
create function public.invite_gateway(p_hash text, p_rate_key text,
  p_user_id uuid default null, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_invite public.trip_invites; v_request public.trip_join_requests; v_attempts integer;
begin
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then raise exception 'Invalid rate key'; end if;
  delete from private.invite_attempts where window_start < now() - interval '1 day';
  insert into private.invite_attempts as a values(p_rate_key, now(), 1)
    on conflict (rate_key) do update set
      attempts = case when a.window_start < now() - interval '10 minutes' then 1 else a.attempts + 1 end,
      window_start = case when a.window_start < now() - interval '10 minutes' then now() else a.window_start end
    returning attempts into v_attempts;
  -- Return errors instead of raising: failed attempts must commit the rate limit.
  if v_attempts > 20 then return jsonb_build_object('error', 'rate_limited'); end if;
  select * into v_invite from public.trip_invites where token_hash = p_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now()
    or not exists(select 1 from public.trips where id = v_invite.trip_id and status = 'active') then
    return jsonb_build_object('error', 'invalid_invite');
  end if;
  if p_user_id is not null then
    select * into v_request from public.trip_join_requests
      where trip_id = v_invite.trip_id and auth_user_id = p_user_id;
    if found then return jsonb_build_object('request_id', v_request.id, 'status', v_request.status); end if;
  end if;
  if v_invite.uses_count >= v_invite.max_uses then return jsonb_build_object('error', 'invalid_invite'); end if;
  if p_user_id is null then return jsonb_build_object('valid', true); end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    return jsonb_build_object('error', 'invalid_name');
  end if;
  -- Serialize distinct invitations for the same trip/user too.
  perform pg_advisory_xact_lock(hashtextextended(v_invite.trip_id::text || p_user_id::text, 0));
  select * into v_request from public.trip_join_requests
    where trip_id = v_invite.trip_id and auth_user_id = p_user_id;
  if found then return jsonb_build_object('request_id', v_request.id, 'status', v_request.status); end if;
  if exists(select 1 from public.trip_members where trip_id = v_invite.trip_id and user_id = p_user_id) then
    return jsonb_build_object('error', 'supervised_rejoin_required');
  end if;
  insert into public.trip_join_requests(trip_id, invite_id, auth_user_id, requested_display_name)
    values(v_invite.trip_id, v_invite.id, p_user_id, btrim(p_name)) returning * into v_request;
  update public.trip_invites set uses_count = uses_count + 1 where id = v_invite.id;
  return jsonb_build_object('request_id', v_request.id, 'status', 'pending');
end;
$$;

create function public.decide_join(p_request_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_request public.trip_join_requests;
begin
  select * into v_request from public.trip_join_requests where id = p_request_id for update;
  perform private.assert_organizer(v_request.trip_id);
  if v_request.status <> 'pending' then return; end if;
  if p_approve is null then raise exception 'Decision required'; end if;
  if p_approve then
    if not exists(select 1 from public.trips where id = v_request.trip_id and status = 'active') then
      raise exception 'Trip archived';
    end if;
    insert into public.trip_members(trip_id, user_id, display_name)
      values(v_request.trip_id, v_request.auth_user_id, v_request.requested_display_name);
  end if;
  update public.trip_join_requests set status = case when p_approve then 'approved' else 'denied' end,
    decided_at = now() where id = p_request_id;
end;
$$;

create function public.add_managed_member(p_trip_id uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.assert_organizer(p_trip_id);
  if not exists(select 1 from public.trips where id = p_trip_id and status = 'active') then raise exception 'Trip archived'; end if;
  insert into public.trip_members(trip_id, display_name, managed_by_user_id)
    values(p_trip_id, btrim(p_name), auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
create function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_member public.trip_members;
begin
  select * into v_member from public.trip_members where id = p_member_id for update;
  perform private.assert_organizer(v_member.trip_id);
  if v_member.role = 'organizer' then raise exception 'Cannot remove organizer'; end if;
  update public.trip_members set status = 'removed' where id = p_member_id;
  update public.trip_join_requests set status = 'denied', decided_at = now()
    where trip_id = v_member.trip_id and auth_user_id = v_member.user_id;
end;
$$;

-- Supabase defaults grant broad access: explicitly narrow every object and RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.trips, public.trip_members, public.trip_join_requests to authenticated;
grant select(id, trip_id, expires_at, max_uses, uses_count, revoked_at, created_at)
  on public.trip_invites to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.is_trip_member(uuid), public.is_trip_organizer(uuid),
  public.create_trip(text,text,text,text,date,date), public.archive_trip(uuid),
  public.create_invite(uuid,integer,integer), public.revoke_invite(uuid),
  public.decide_join(uuid,boolean), public.add_managed_member(uuid,text), public.remove_member(uuid)
  to authenticated;
grant execute on function public.invite_gateway(text,text,uuid,text) to service_role;
