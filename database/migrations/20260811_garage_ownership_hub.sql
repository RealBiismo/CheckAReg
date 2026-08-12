create table if not exists public.vehicle_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  registration text not null check (registration ~ '^[A-Z0-9]{2,8}$'),
  nickname text check (nickname is null or length(nickname) <= 40),
  photo_path text check (photo_path is null or length(photo_path) <= 500),
  current_mileage integer check (current_mileage is null or current_mileage between 0 and 2000000),
  insurance_renewal_date date,
  service_due_date date,
  service_due_mileage integer check (service_due_mileage is null or service_due_mileage between 0 and 2000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, registration),
  foreign key (user_id, registration) references public.saved_vehicles(user_id, registration) on delete cascade
);

create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registration text not null check (registration ~ '^[A-Z0-9]{2,8}$'),
  event_date date not null default current_date,
  category text not null default 'note' check (category in ('service','repair','tyres','brakes','mot','tax','insurance','note','other')),
  title text not null check (length(title) between 1 and 80),
  notes text check (notes is null or length(notes) <= 1000),
  mileage integer check (mileage is null or mileage between 0 and 2000000),
  cost_pence integer check (cost_pence is null or cost_pence between 0 and 100000000),
  created_at timestamptz not null default now(),
  foreign key (user_id, registration) references public.saved_vehicles(user_id, registration) on delete cascade
);

create index if not exists vehicle_maintenance_user_reg_date_idx
on public.vehicle_maintenance (user_id, registration, event_date desc, created_at desc);

alter table public.vehicle_profiles enable row level security;
alter table public.vehicle_maintenance enable row level security;

revoke all on table public.vehicle_profiles from public, anon, authenticated;
revoke all on table public.vehicle_maintenance from public, anon, authenticated;
grant select, insert, update, delete on table public.vehicle_profiles to authenticated;
grant select, insert, update, delete on table public.vehicle_maintenance to authenticated;

drop policy if exists "Users can view their own vehicle profiles" on public.vehicle_profiles;
create policy "Users can view their own vehicle profiles" on public.vehicle_profiles
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own vehicle profiles" on public.vehicle_profiles;
create policy "Users can create their own vehicle profiles" on public.vehicle_profiles
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own vehicle profiles" on public.vehicle_profiles;
create policy "Users can update their own vehicle profiles" on public.vehicle_profiles
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own vehicle profiles" on public.vehicle_profiles;
create policy "Users can delete their own vehicle profiles" on public.vehicle_profiles
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own maintenance" on public.vehicle_maintenance;
create policy "Users can view their own maintenance" on public.vehicle_maintenance
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own maintenance" on public.vehicle_maintenance;
create policy "Users can create their own maintenance" on public.vehicle_maintenance
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own maintenance" on public.vehicle_maintenance;
create policy "Users can update their own maintenance" on public.vehicle_maintenance
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own maintenance" on public.vehicle_maintenance;
create policy "Users can delete their own maintenance" on public.vehicle_maintenance
for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Vehicle photo owners can read" on storage.objects;
create policy "Vehicle photo owners can read" on storage.objects
for select to authenticated
using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Vehicle photo owners can upload" on storage.objects;
create policy "Vehicle photo owners can upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Vehicle photo owners can update" on storage.objects;
create policy "Vehicle photo owners can update" on storage.objects
for update to authenticated
using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Vehicle photo owners can delete" on storage.objects;
create policy "Vehicle photo owners can delete" on storage.objects
for delete to authenticated
using (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.get_my_vehicle_check_history(p_registration text, p_limit integer default 12)
returns table (id uuid, registration text, searched_at timestamptz, credit_cost smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration text := upper(regexp_replace(coalesce(p_registration, ''), '[^A-Za-z0-9]', '', 'g'));
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view your vehicle check history.';
  end if;
  if v_registration !~ '^[A-Z0-9]{2,8}$' then
    raise invalid_parameter_value using message = 'Invalid registration.';
  end if;
  if not exists (
    select 1 from public.saved_vehicles sv
    where sv.user_id = v_user_id and sv.registration = v_registration
  ) then
    raise insufficient_privilege using message = 'That registration is not in your garage.';
  end if;

  return query
  select vs.id, vs.registration, coalesce(vs.finished_at, vs.created_at), vs.credit_cost
  from private.vehicle_searches vs
  where vs.user_id = v_user_id
    and vs.registration = v_registration
    and vs.status = 'completed'
  order by coalesce(vs.finished_at, vs.created_at) desc
  limit v_limit;
end;
$$;

revoke all on function public.get_my_vehicle_check_history(text, integer) from public, anon;
grant execute on function public.get_my_vehicle_check_history(text, integer) to authenticated;

insert into public.vehicle_profiles (user_id, registration, current_mileage)
select user_id, registration, last_mileage
from public.saved_vehicles
where last_mileage is not null
on conflict (user_id, registration) do update
set current_mileage = coalesce(public.vehicle_profiles.current_mileage, excluded.current_mileage);

create or replace function private.seed_vehicle_profile_mileage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.vehicle_profiles (user_id, registration, current_mileage)
  values (new.user_id, new.registration, new.last_mileage)
  on conflict (user_id, registration) do update
  set current_mileage = coalesce(public.vehicle_profiles.current_mileage, excluded.current_mileage);
  return new;
end;
$$;

drop trigger if exists saved_vehicle_seed_profile_mileage on public.saved_vehicles;
create trigger saved_vehicle_seed_profile_mileage
after insert or update of last_mileage on public.saved_vehicles
for each row execute function private.seed_vehicle_profile_mileage();
