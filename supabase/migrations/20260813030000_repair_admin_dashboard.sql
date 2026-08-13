-- Complete the staff portal data layer and keep the dashboard renderer aligned
-- with the redesigned Check A Reg account page.

create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_id uuid := auth.uid();
  v_today date := timezone('Europe/London', now())::date;
  v_recent_signups jsonb;
  v_recent_searches jsonb;
  v_banned_users jsonb;
begin
  if v_staff_id is null or not (
    exists (select 1 from private.app_admins where user_id = v_staff_id)
    or exists (select 1 from private.app_moderators where user_id = v_staff_id)
  ) then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_recent_signups
  from (
    select lower(u.email) as email, u.created_at,
           (u.email_confirmed_at is not null) as confirmed,
           (u.banned_until is not null and u.banned_until > now()) as banned,
           (lower(u.email) = 'cybzerohq@gmail.com') as owner
    from auth.users u
    where u.email is not null
    order by u.created_at desc
    limit 8
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_recent_searches
  from (
    select s.registration, lower(u.email) as email, s.status,
           s.credit_cost as "creditCost", s.created_at
    from private.vehicle_searches s
    join auth.users u on u.id = s.user_id
    order by s.created_at desc
    limit 10
  ) item;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.banned_until desc), '[]'::jsonb)
  into v_banned_users
  from (
    select lower(u.email) as email, u.banned_until, u.created_at
    from auth.users u
    where u.banned_until is not null and u.banned_until > now()
    order by u.banned_until desc
    limit 10
  ) item;

  return jsonb_build_object(
    'stats', jsonb_build_object(
      'totalUsers', (select count(*) from auth.users),
      'verifiedUsers', (select count(*) from auth.users where email_confirmed_at is not null),
      'bannedUsers', (select count(*) from auth.users where banned_until is not null and banned_until > now()),
      'pushSubscribers', (select count(distinct user_id) from private.push_subscriptions where enabled),
      'pushDevices', (select count(*) from private.push_subscriptions where enabled),
      'searchesToday', (select count(*) from private.vehicle_searches where search_date = v_today and status in ('reserved', 'completed')),
      'creditsInCirculation', (select coalesce(sum(credits), 0) from private.user_accounts)
    ),
    'recentSignups', v_recent_signups,
    'recentSearches', v_recent_searches,
    'bannedUsers', v_banned_users
  );
end;
$$;

create or replace function public.admin_get_user_credits(p_target_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_joined_at timestamptz;
  v_verified boolean;
  v_banned_until timestamptz;
  v_credits integer;
  v_searches_today integer;
  v_total_searches integer;
  v_saved_vehicles integer;
  v_push_devices integer;
  v_is_admin boolean;
  v_today date := timezone('Europe/London', now())::date;
begin
  if v_staff_id is null or not (
    exists (select 1 from private.app_admins where user_id = v_staff_id)
    or exists (select 1 from private.app_moderators where user_id = v_staff_id)
  ) then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;

  select id, lower(email), created_at, email_confirmed_at is not null, banned_until
  into v_target_id, v_target_email, v_joined_at, v_verified, v_banned_until
  from auth.users
  where lower(email) = lower(trim(p_target_email))
  limit 1;

  if v_target_id is null then
    raise no_data_found using message = 'No Check A Reg account was found for that email.';
  end if;

  insert into private.user_accounts (user_id) values (v_target_id)
  on conflict (user_id) do nothing;

  select credits into v_credits from private.user_accounts where user_id = v_target_id;
  select count(*)::integer into v_searches_today from private.vehicle_searches
    where user_id = v_target_id and search_date = v_today and status in ('reserved', 'completed');
  select count(*)::integer into v_total_searches from private.vehicle_searches
    where user_id = v_target_id and status = 'completed';
  select count(*)::integer into v_saved_vehicles from public.saved_vehicles
    where user_id = v_target_id;
  select count(*)::integer into v_push_devices from private.push_subscriptions
    where user_id = v_target_id and enabled;
  select exists (select 1 from private.app_admins where user_id = v_target_id) into v_is_admin;

  return jsonb_build_object(
    'email', v_target_email,
    'credits', v_credits,
    'dailyLimit', 5,
    'searchesToday', v_searches_today,
    'totalSearches', v_total_searches,
    'freeUsed', least(v_searches_today, 5),
    'freeRemaining', greatest(5 - v_searches_today, 0),
    'savedVehicles', v_saved_vehicles,
    'pushDevices', v_push_devices,
    'joinedAt', v_joined_at,
    'verified', v_verified,
    'banned', v_banned_until is not null and v_banned_until > now(),
    'bannedUntil', v_banned_until,
    'isAdmin', v_is_admin,
    'isOwner', v_target_email = 'cybzerohq@gmail.com'
  );
end;
$$;

create or replace function public.staff_list_accounts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_staff_id uuid := auth.uid();
  v_accounts jsonb;
begin
  if v_staff_id is null or not (
    exists (select 1 from private.app_admins where user_id = v_staff_id)
    or exists (select 1 from private.app_moderators where user_id = v_staff_id)
  ) then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_accounts
  from (
    select lower(u.email) as email,
           case
             when lower(u.email) = 'cybzerohq@gmail.com' then 'owner'
             when a.user_id is not null then 'admin'
             when m.user_id is not null then 'moderator'
             else 'user'
           end as role,
           u.email_confirmed_at is not null as verified,
           u.banned_until is not null and u.banned_until > now() as banned,
           coalesce(ua.credits, 0) as credits,
           (select count(*) from private.vehicle_searches s where s.user_id = u.id and s.status = 'completed') as total_searches,
           u.created_at
    from auth.users u
    left join private.user_accounts ua on ua.user_id = u.id
    left join private.app_admins a on a.user_id = u.id
    left join private.app_moderators m on m.user_id = u.id
    where u.email is not null
    order by u.created_at desc
    limit 500
  ) item;

  return jsonb_build_object('accounts', v_accounts);
end;
$$;

create or replace function public.admin_get_ai_logs(p_target_email text, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_logs jsonb;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Check A Reg admin access is required.';
  end if;

  select id, lower(email) into v_target_id, v_target_email
  from auth.users where lower(email) = lower(trim(p_target_email)) limit 1;
  if v_target_id is null then
    raise no_data_found using message = 'No Check A Reg account was found for that email.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'registration', c.registration,
    'category', c.category,
    'title', c.title,
    'status', c.status,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at,
    'deletedByUser', c.user_deleted_at is not null,
    'deletedAt', c.user_deleted_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'role', msg.role,
        'content', msg.content,
        'imageCount', msg.image_count,
        'createdAt', msg.created_at
      ) order by msg.id)
      from public.ai_mechanic_messages msg
      where msg.case_id = c.id
    ), '[]'::jsonb)
  ) order by c.created_at desc), '[]'::jsonb)
  into v_logs
  from (
    select * from public.ai_mechanic_cases
    where user_id = v_target_id
    order by created_at desc
    limit v_limit
  ) c;

  return jsonb_build_object('email', v_target_email, 'logs', v_logs);
end;
$$;

revoke all on function public.admin_get_dashboard() from public, anon;
revoke all on function public.admin_get_user_credits(text) from public, anon;
revoke all on function public.staff_list_accounts() from public, anon;
revoke all on function public.admin_get_ai_logs(text, integer) from public, anon;

grant execute on function public.admin_get_dashboard() to authenticated;
grant execute on function public.admin_get_user_credits(text) to authenticated;
grant execute on function public.staff_list_accounts() to authenticated;
grant execute on function public.admin_get_ai_logs(text, integer) to authenticated;
