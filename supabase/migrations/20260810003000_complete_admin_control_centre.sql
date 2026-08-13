create table if not exists private.user_ban_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_email text not null,
  banned boolean not null,
  created_at timestamptz not null default now()
);

alter table private.user_ban_audit enable row level security;
revoke all on table private.user_ban_audit from public, anon, authenticated;
create index if not exists user_ban_audit_target_created_idx
on private.user_ban_audit (target_user_id, created_at desc);

create or replace function public.admin_get_user_credits(p_target_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_banned_until timestamptz;
  v_credits integer;
  v_used integer;
  v_push_devices integer;
  v_is_admin boolean;
  v_today date := timezone('Europe/London', now())::date;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view user accounts.';
  end if;

  select id, lower(email), banned_until
  into v_target_id, v_target_email, v_banned_until
  from auth.users
  where lower(email) = lower(trim(p_target_email))
    and email_confirmed_at is not null
  limit 1;

  if v_target_id is null then
    raise no_data_found using message = 'No verified CHECK A REG account was found for that email.';
  end if;

  insert into private.user_accounts (user_id) values (v_target_id)
  on conflict (user_id) do nothing;

  select credits into v_credits from private.user_accounts where user_id = v_target_id;
  select count(*)::integer into v_used
  from private.vehicle_searches
  where user_id = v_target_id and search_date = v_today and status in ('reserved', 'completed');
  select count(*)::integer into v_push_devices
  from private.push_subscriptions where user_id = v_target_id and enabled;
  select exists (select 1 from private.app_admins where user_id = v_target_id) into v_is_admin;

  return jsonb_build_object(
    'email', v_target_email,
    'credits', v_credits,
    'dailyLimit', 5,
    'freeUsed', least(v_used, 5),
    'freeRemaining', greatest(5 - v_used, 0),
    'pushDevices', v_push_devices,
    'banned', v_banned_until is not null and v_banned_until > now(),
    'bannedUntil', v_banned_until,
    'isAdmin', v_is_admin,
    'isOwner', v_target_email = 'cybzerohq@gmail.com'
  );
end;
$$;

create or replace function public.admin_set_user_ban(p_target_email text, p_banned boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can manage account access.';
  end if;
  if p_banned is null then
    raise invalid_parameter_value using message = 'Choose whether this account should be banned.';
  end if;

  select id, lower(email) into v_target_id, v_target_email
  from auth.users
  where lower(email) = lower(trim(p_target_email)) and email_confirmed_at is not null
  limit 1;

  if v_target_id is null then
    raise no_data_found using message = 'No verified CHECK A REG account was found for that email.';
  end if;
  if exists (select 1 from private.app_admins where user_id = v_target_id) then
    raise invalid_parameter_value using message = 'Admin accounts cannot be banned.';
  end if;

  update auth.users
  set banned_until = case when p_banned then 'infinity'::timestamptz else null end,
      updated_at = now()
  where id = v_target_id;

  if p_banned then
    update private.push_subscriptions set enabled = false, updated_at = now() where user_id = v_target_id;
    delete from auth.refresh_tokens where user_id = v_target_id::text;
    delete from auth.sessions where user_id = v_target_id;
  end if;

  insert into private.user_ban_audit (admin_id, target_user_id, target_email, banned)
  values (v_admin_id, v_target_id, v_target_email, p_banned);

  return jsonb_build_object('email', v_target_email, 'banned', p_banned, 'isAdmin', false, 'isOwner', false);
end;
$$;

create or replace function public.admin_get_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_today date := timezone('Europe/London', now())::date;
  v_recent_signups jsonb;
  v_recent_searches jsonb;
  v_banned_users jsonb;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view dashboard insights.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_recent_signups
  from (
    select lower(u.email) as email, u.created_at,
           (u.email_confirmed_at is not null) as confirmed,
           (u.banned_until is not null and u.banned_until > now()) as banned,
           (lower(u.email) = 'cybzerohq@gmail.com') as owner
    from auth.users u where u.email is not null order by u.created_at desc limit 8
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_recent_searches
  from (
    select s.registration, lower(u.email) as email, s.status,
           s.credit_cost as "creditCost", s.created_at
    from private.vehicle_searches s
    join auth.users u on u.id = s.user_id
    order by s.created_at desc limit 10
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.banned_until desc), '[]'::jsonb)
  into v_banned_users
  from (
    select lower(u.email) as email, u.banned_until, u.created_at
    from auth.users u
    where u.banned_until is not null and u.banned_until > now()
    order by u.banned_until desc limit 10
  ) item;

  return jsonb_build_object(
    'stats', jsonb_build_object(
      'totalUsers', (select count(*) from auth.users),
      'verifiedUsers', (select count(*) from auth.users where email_confirmed_at is not null),
      'bannedUsers', (select count(*) from auth.users where banned_until is not null and banned_until > now()),
      'pushSubscribers', (select count(distinct user_id) from private.push_subscriptions where enabled),
      'pushDevices', (select count(*) from private.push_subscriptions where enabled),
      'searchesToday', (select count(*) from private.vehicle_searches where search_date = v_today and status in ('reserved', 'completed'))
    ),
    'recentSignups', v_recent_signups,
    'recentSearches', v_recent_searches,
    'bannedUsers', v_banned_users
  );
end;
$$;

create or replace function public.admin_delete_broadcast(p_broadcast_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_deleted uuid;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can delete broadcast history.';
  end if;

  delete from private.admin_push_notifications
  where id = p_broadcast_id and is_broadcast
  returning id into v_deleted;

  if v_deleted is null then
    raise no_data_found using message = 'That broadcast history item was not found.';
  end if;

  return jsonb_build_object('deleted', true, 'id', v_deleted);
end;
$$;

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and (banned_until is null or banned_until <= now())
  );
$$;

revoke all on function public.admin_get_user_credits(text) from public, anon;
revoke all on function public.admin_set_user_ban(text, boolean) from public, anon;
revoke all on function public.admin_get_dashboard() from public, anon;
revoke all on function public.admin_delete_broadcast(uuid) from public, anon;
revoke all on function public.current_user_is_active() from public, anon;

grant execute on function public.admin_get_user_credits(text) to authenticated;
grant execute on function public.admin_set_user_ban(text, boolean) to authenticated;
grant execute on function public.admin_get_dashboard() to authenticated;
grant execute on function public.admin_delete_broadcast(uuid) to authenticated;
grant execute on function public.current_user_is_active() to authenticated;

drop policy if exists "Users can view their own saved vehicles" on public.saved_vehicles;
drop policy if exists "Users can save their own vehicles" on public.saved_vehicles;
drop policy if exists "Users can update their own saved vehicles" on public.saved_vehicles;
drop policy if exists "Users can remove their own saved vehicles" on public.saved_vehicles;

create policy "Users can view their own saved vehicles"
on public.saved_vehicles
for select
to authenticated
using ((select auth.uid()) = user_id and public.current_user_is_active());

create policy "Users can save their own vehicles"
on public.saved_vehicles
for insert
to authenticated
with check ((select auth.uid()) = user_id and public.current_user_is_active());

create policy "Users can update their own saved vehicles"
on public.saved_vehicles
for update
to authenticated
using ((select auth.uid()) = user_id and public.current_user_is_active())
with check ((select auth.uid()) = user_id and public.current_user_is_active());

create policy "Users can remove their own saved vehicles"
on public.saved_vehicles
for delete
to authenticated
using ((select auth.uid()) = user_id and public.current_user_is_active());
