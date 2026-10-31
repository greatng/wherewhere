-- Trip creation requires an email-verified account. Existing guest memberships remain intact.
create or replace function public.create_trip(p_title text, p_name text, p_timezone text,
  p_currency text, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from auth.users u where u.id = auth.uid()
    and coalesce(u.is_anonymous, false) = false
    and nullif(btrim(u.email), '') is not null and u.email_confirmed_at is not null) then
    raise exception 'Verify your email before creating a trip' using errcode = '42501';
  end if;
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

revoke execute on function public.create_trip(text,text,text,text,date,date) from public, anon;
grant execute on function public.create_trip(text,text,text,text,date,date) to authenticated;
notify pgrst, 'reload schema';
