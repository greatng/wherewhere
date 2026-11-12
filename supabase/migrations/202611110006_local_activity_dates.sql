-- An explicitly supplied plan_date is the user's local calendar date. Keep
-- the trip timezone only as the fallback for older callers that omit it.
create or replace function public.upsert_itinerary_item(
 p_trip_id uuid,
 p_title text,
 p_starts_at timestamptz default null,
 p_address text default null,
 p_latitude double precision default null,
 p_longitude double precision default null,
 p_meeting_info text default null,
 p_notes text default null,
 p_position integer default 0,
 p_transport_mode text default null,
 p_item_id uuid default null,
 p_expected_version integer default null,
 p_plan_date date default null
)
returns public.itinerary_items
language plpgsql security definer set search_path='' as $$
declare
 v_item public.itinerary_items;
 v_date date;
 v_zone text;
begin
 perform private.assert_organizer(p_trip_id);
 perform private.assert_active_trip(p_trip_id);
 select timezone into v_zone from public.trips where id=p_trip_id;
 v_date:=coalesce(p_plan_date,(p_starts_at at time zone v_zone)::date);
 if v_date is not null then perform private.assert_trip_dates(p_trip_id,v_date,v_date); end if;
 v_item:=private.upsert_itinerary_item(p_trip_id,p_title,p_starts_at,p_address,p_latitude,p_longitude,p_meeting_info,p_notes,p_position,p_transport_mode,p_item_id,p_expected_version);
 update public.itinerary_items set plan_date=v_date where id=v_item.id returning * into v_item;
 return v_item;
end; $$;

notify pgrst,'reload schema';
