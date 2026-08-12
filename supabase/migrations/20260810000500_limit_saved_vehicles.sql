create or replace function public.enforce_saved_vehicle_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 0)
  );

  -- Upserts of an already-saved registration remain allowed at the limit.
  if exists (
    select 1
    from public.saved_vehicles
    where user_id = new.user_id
      and registration = new.registration
  ) then
    return new;
  end if;

  if (
    select count(*)
    from public.saved_vehicles
    where user_id = new.user_id
  ) >= 3 then
    raise exception using
      errcode = 'P0001',
      message = 'Garage limit reached. Each account can save up to 3 vehicles. Remove one before saving another.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_saved_vehicle_limit() from public, anon, authenticated;

drop trigger if exists enforce_saved_vehicle_limit on public.saved_vehicles;

create trigger enforce_saved_vehicle_limit
before insert on public.saved_vehicles
for each row
execute function public.enforce_saved_vehicle_limit();