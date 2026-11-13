create or replace function public.set_trip_timezone(p_trip_id uuid, p_timezone text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_organizer(p_trip_id);
  perform private.assert_active_trip(p_trip_id);
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception 'Invalid timezone';
  end if;
  update public.trips set timezone = p_timezone where id = p_trip_id;
end;
$$;

revoke all on function public.set_trip_timezone(uuid,text) from public, anon;
grant execute on function public.set_trip_timezone(uuid,text) to authenticated;

notify pgrst, 'reload schema';
