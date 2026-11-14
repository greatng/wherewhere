alter table public.trip_invites add column deleted_at timestamptz;

drop policy invites_read on public.trip_invites;
create policy invites_read on public.trip_invites for select to authenticated
  using (public.is_trip_organizer(trip_id) and deleted_at is null);

create function public.delete_revoked_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_invite public.trip_invites;
begin
  select * into v_invite from public.trip_invites where id = p_invite_id for update;
  if not found then raise exception 'Invitation not found'; end if;
  perform private.assert_organizer(v_invite.trip_id);
  if v_invite.revoked_at is null then
    raise exception 'Only revoked invitations can be deleted';
  end if;
  update public.trip_invites set deleted_at = coalesce(deleted_at, now())
    where id = v_invite.id;
end;
$$;

grant select(deleted_at) on public.trip_invites to authenticated;
revoke execute on function public.delete_revoked_invite(uuid) from public, anon;
grant execute on function public.delete_revoked_invite(uuid) to authenticated;
