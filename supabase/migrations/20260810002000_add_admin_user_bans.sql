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
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view user credits.';
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

  select exists (select 1 from private.app_admins where user_id = v_target_id)
  into v_is_admin;

  insert into private.user_accounts (user_id)
  values (v_target_id)
  on conflict (user_id) do nothing;

  select credits into v_credits
  from private.user_accounts
  where user_id = v_target_id;

  select count(*)::integer into v_used
  from private.vehicle_searches
  where user_id = v_target_id
    and search_date = v_today
    and status in ('reserved', 'completed');

  select count(*)::integer into v_push_devices
  from private.push_subscriptions
  where user_id = v_target_id and enabled;

  return jsonb_build_object(
    'email', v_target_email,
    'credits', v_credits,
    'dailyLimit', 5,
    'freeUsed', least(v_used, 5),
    'freeRemaining', greatest(5 - v_used, 0),
    'pushDevices', v_push_devices,
    'banned', v_banned_until is not null and v_banned_until > now(),
    'isAdmin', v_is_admin,
    'isOwner', v_target_id = '00d08e31-69b7-48ff-b898-815da4b302e6'::uuid
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
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can manage account access.';
  end if;

  if p_banned is null then
    raise invalid_parameter_value using message = 'Choose whether this account should be banned.';
  end if;

  select id, lower(email)
  into v_target_id, v_target_email
  from auth.users
  where lower(email) = lower(trim(p_target_email))
    and email_confirmed_at is not null
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
    update private.push_subscriptions
    set enabled = false, updated_at = now()
    where user_id = v_target_id;

    delete from auth.refresh_tokens where user_id = v_target_id::text;
    delete from auth.sessions where user_id = v_target_id;
  end if;

  insert into private.user_ban_audit (admin_id, target_user_id, target_email, banned)
  values (v_admin_id, v_target_id, v_target_email, p_banned);

  return jsonb_build_object(
    'email', v_target_email,
    'banned', p_banned,
    'isAdmin', false,
    'isOwner', false
  );
end;
$$;

revoke all on function public.admin_get_user_credits(text) from public, anon;
revoke all on function public.admin_set_user_ban(text, boolean) from public, anon;
grant execute on function public.admin_get_user_credits(text) to authenticated;
grant execute on function public.admin_set_user_ban(text, boolean) to authenticated;
