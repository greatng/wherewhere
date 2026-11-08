-- Organizer-mediated recovery for denied join requests and removed members.
-- Identity verification is an explicit organizer assertion made by the caller;
-- guest and invite redemption paths cannot invoke either recovery operation.
create table private.guest_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  action text not null check (action in ('reopen_join_request', 'recover_member')),
  request_id uuid references public.trip_join_requests(id) on delete cascade,
  member_id uuid references public.trip_members(id) on delete cascade,
  changed_by uuid not null references auth.users(id),
  from_user_id uuid references auth.users(id),
  to_user_id uuid references auth.users(id),
  from_status text,
  to_status text not null,
  identity_verified boolean not null check (identity_verified),
  changed_at timestamptz not null default now(),
  check ((action = 'reopen_join_request' and request_id is not null and member_id is null)
    or (action = 'recover_member' and member_id is not null and request_id is null))
);
alter table private.guest_recovery_audit enable row level security;

create function public.reopen_join_request(
  p_request_id uuid, p_identity_verified boolean, p_invite_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_request public.trip_join_requests; v_invite public.trip_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_request from public.trip_join_requests where id = p_request_id for update;
  if not found then raise exception 'Join request not found'; end if;
  perform private.assert_organizer(v_request.trip_id);
  if p_identity_verified is distinct from true then
    raise exception 'Identity verification required' using errcode = '42501';
  end if;
  if v_request.status <> 'denied' then raise exception 'Only denied requests can be reopened'; end if;
  perform private.assert_active_trip(v_request.trip_id);
  select * into v_invite from public.trip_invites where id =
    coalesce(p_invite_id, v_request.invite_id) and trip_id = v_request.trip_id for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now()
    or (v_invite.id is distinct from v_request.invite_id and v_invite.uses_count >= v_invite.max_uses) then
    raise exception 'Original invitation is no longer valid';
  end if;
  if exists(select 1 from public.trip_members where trip_id = v_request.trip_id
      and user_id = v_request.auth_user_id and status = 'approved') then
    raise exception 'Identity already has trip access';
  end if;
  update public.trip_join_requests set status = 'pending', decided_at = null,
    invite_id = coalesce(p_invite_id, invite_id) where id = v_request.id;
  if p_invite_id is not null and p_invite_id is distinct from v_request.invite_id then
    update public.trip_invites set uses_count = uses_count + 1 where id = p_invite_id;
  end if;
  insert into private.guest_recovery_audit
    (trip_id, action, request_id, changed_by, from_user_id, to_user_id,
     from_status, to_status, identity_verified)
  values (v_request.trip_id, 'reopen_join_request', v_request.id, auth.uid(),
    v_request.auth_user_id, v_request.auth_user_id, v_request.status, 'pending', true);
end;
$$;

create function public.recover_member(
  p_member_id uuid, p_request_id uuid, p_identity_verified boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_member public.trip_members; v_request public.trip_join_requests;
  v_invite public.trip_invites; v_old_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_member from public.trip_members where id = p_member_id for update;
  if not found then raise exception 'Member not found'; end if;
  perform private.assert_organizer(v_member.trip_id);
  if p_identity_verified is distinct from true then
    raise exception 'Identity verification required' using errcode = '42501';
  end if;
  if v_member.role <> 'member' or v_member.status <> 'removed' then
    raise exception 'Only removed members can be recovered';
  end if;
  select * into v_request from public.trip_join_requests where id = p_request_id for update;
  if not found or v_request.trip_id <> v_member.trip_id then
    raise exception 'Join request does not belong to this member trip';
  end if;
  if v_request.status <> 'pending' then raise exception 'A pending join request is required'; end if;
  perform private.assert_active_trip(v_member.trip_id);
  if not exists(select 1 from auth.users u where u.id = v_request.auth_user_id) then
    raise exception 'Join request account no longer exists';
  end if;
  if exists(select 1 from public.trip_members where trip_id = v_member.trip_id
      and user_id = v_request.auth_user_id and id <> v_member.id) then
    raise exception 'Account already has a member record for this trip';
  end if;
  select * into v_invite from public.trip_invites
    where id = v_request.invite_id and trip_id = v_member.trip_id for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
    raise exception 'Join request invitation is no longer valid';
  end if;

  v_old_user_id := v_member.user_id;
  -- Keep the existing member row so expenses and all other member references stay intact.
  update public.trip_members set user_id = v_request.auth_user_id, managed_by_user_id = null,
      status = 'approved'
    where id = v_member.id;

  -- Remove any other request-based access for the prior identity, then mark the
  -- selected identity's existing request as organizer-approved when present.
  if v_old_user_id is not null and v_old_user_id is distinct from v_request.auth_user_id then
    update public.trip_join_requests set status = 'denied', decided_at = now()
      where trip_id = v_member.trip_id and auth_user_id = v_old_user_id
        and status in ('pending', 'approved');
  end if;
  update public.trip_join_requests set status = 'approved', decided_at = now()
    where id = v_request.id;

  insert into private.guest_recovery_audit
    (trip_id, action, member_id, changed_by, from_user_id, to_user_id,
     from_status, to_status, identity_verified)
  values (v_member.trip_id, 'recover_member', v_member.id, auth.uid(),
    v_old_user_id, v_request.auth_user_id, v_member.status, 'approved', true);
end;
$$;

-- A reopened request for the same account should restore the existing row, so
-- all expenses and other references continue to point at the same member ID.
create or replace function public.decide_join(p_request_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_request public.trip_join_requests; v_member public.trip_members;
begin
  select * into v_request from public.trip_join_requests where id = p_request_id for update;
  if not found then raise exception 'Join request not found'; end if;
  perform private.assert_organizer(v_request.trip_id);
  if v_request.status <> 'pending' then return; end if;
  if p_approve is null then raise exception 'Decision required'; end if;
  if p_approve then
    if not exists(select 1 from public.trips where id = v_request.trip_id and status = 'active') then
      raise exception 'Trip archived';
    end if;
    if not exists(select 1 from public.trip_invites i where i.id = v_request.invite_id
        and i.trip_id = v_request.trip_id and i.revoked_at is null and i.expires_at > now()) then
      raise exception 'Invitation is no longer valid';
    end if;
    select * into v_member from public.trip_members
      where trip_id = v_request.trip_id and user_id = v_request.auth_user_id for update;
    if found then
      if v_member.status <> 'removed' then raise exception 'Identity already has trip access'; end if;
      update public.trip_members set status = 'approved', display_name = v_request.requested_display_name
        where id = v_member.id;
    else
      insert into public.trip_members(trip_id, user_id, display_name)
        values(v_request.trip_id, v_request.auth_user_id, v_request.requested_display_name);
    end if;
  end if;
  update public.trip_join_requests set status = case when p_approve then 'approved' else 'denied' end,
    decided_at = now() where id = p_request_id;
end;
$$;

revoke execute on function public.reopen_join_request(uuid,boolean,uuid),
  public.recover_member(uuid,uuid,boolean) from public, anon;
grant execute on function public.reopen_join_request(uuid,boolean,uuid),
  public.recover_member(uuid,uuid,boolean), public.decide_join(uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
