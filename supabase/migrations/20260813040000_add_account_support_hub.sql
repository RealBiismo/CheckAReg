-- Personal account profiles and a secure customer support inbox.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  notify_vehicle_reminders boolean not null default true,
  notify_product_updates boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_check
    check (display_name is null or char_length(display_name) between 1 and 50),
  constraint user_profiles_avatar_path_check
    check (
      avatar_path is null
      or (
        split_part(avatar_path, '/', 1) = 'avatars'
        and split_part(avatar_path, '/', 2) = user_id::text
        and char_length(avatar_path) <= 220
      )
    )
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  subject text not null,
  description text not null,
  registration text,
  screenshot_path text,
  page_url text,
  user_agent text,
  status text not null default 'open',
  staff_response text,
  responded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  resolved_at timestamptz,
  constraint support_tickets_category_check
    check (category in ('bug', 'vehicle_data', 'billing', 'account', 'suggestion', 'other')),
  constraint support_tickets_subject_check
    check (char_length(trim(subject)) between 5 and 100),
  constraint support_tickets_description_check
    check (char_length(trim(description)) between 10 and 2000),
  constraint support_tickets_registration_check
    check (registration is null or registration ~ '^[A-Z0-9]{2,8}$'),
  constraint support_tickets_screenshot_path_check
    check (
      screenshot_path is null
      or (
        split_part(screenshot_path, '/', 1) = 'support'
        and split_part(screenshot_path, '/', 2) = user_id::text
        and char_length(screenshot_path) <= 220
      )
    ),
  constraint support_tickets_page_url_check
    check (page_url is null or char_length(page_url) <= 500),
  constraint support_tickets_user_agent_check
    check (user_agent is null or char_length(user_agent) <= 500),
  constraint support_tickets_status_check
    check (status in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  constraint support_tickets_staff_response_check
    check (staff_response is null or char_length(trim(staff_response)) between 1 and 2000)
);

create index if not exists support_tickets_user_created_idx
  on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_created_idx
  on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_responded_by_idx
  on public.support_tickets(responded_by);

create or replace function public.set_account_row_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_account_row_updated_at();

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_account_row_updated_at();

create or replace function public.is_app_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from private.app_admins where user_id = auth.uid())
    or exists (select 1 from private.app_moderators where user_id = auth.uid())
  );
$$;

alter table public.user_profiles enable row level security;
alter table public.support_tickets enable row level security;

drop policy if exists "Users read their profile" on public.user_profiles;
create policy "Users read their profile"
on public.user_profiles for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users create their profile" on public.user_profiles;
create policy "Users create their profile"
on public.user_profiles for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users update their profile" on public.user_profiles;
create policy "Users update their profile"
on public.user_profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users read their tickets" on public.support_tickets;
create policy "Users read their tickets"
on public.support_tickets for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users create their tickets" on public.support_tickets;
create policy "Users create their tickets"
on public.support_tickets for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'open'
  and staff_response is null
  and responded_by is null
  and responded_at is null
  and resolved_at is null
);

revoke all on public.user_profiles from public, anon, authenticated;
grant select on public.user_profiles to authenticated;
grant insert (user_id, display_name, avatar_path, notify_vehicle_reminders, notify_product_updates)
  on public.user_profiles to authenticated;
grant update (display_name, avatar_path, notify_vehicle_reminders, notify_product_updates)
  on public.user_profiles to authenticated;

revoke all on public.support_tickets from public, anon, authenticated;
grant select on public.support_tickets to authenticated;
grant insert (id, user_id, category, subject, description, registration, screenshot_path, page_url, user_agent)
  on public.support_tickets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-media',
  'account-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload account media" on storage.objects;
create policy "Users upload account media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'account-media'
  and (storage.foldername(name))[1] in ('avatars', 'support')
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Users and staff read account media" on storage.objects;
create policy "Users and staff read account media"
on storage.objects for select to authenticated
using (
  bucket_id = 'account-media'
  and (
    (storage.foldername(name))[2] = (select auth.uid())::text
    or (select public.is_app_staff())
  )
);

drop policy if exists "Users update account media" on storage.objects;
create policy "Users update account media"
on storage.objects for update to authenticated
using (
  bucket_id = 'account-media'
  and (storage.foldername(name))[2] = (select auth.uid())::text
)
with check (
  bucket_id = 'account-media'
  and (storage.foldername(name))[1] in ('avatars', 'support')
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Users delete account media" on storage.objects;
create policy "Users delete account media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'account-media'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create or replace function public.get_my_account_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_joined_at timestamptz;
  v_provider text;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view your account.';
  end if;

  select u.created_at, coalesce(u.raw_app_meta_data ->> 'provider', 'email')
  into v_joined_at, v_provider
  from auth.users u
  where u.id = v_user_id;

  return jsonb_build_object(
    'joinedAt', v_joined_at,
    'provider', v_provider,
    'savedVehicles', (select count(*) from public.saved_vehicles where user_id = v_user_id),
    'totalSearches', (
      select count(*) from private.vehicle_searches
      where user_id = v_user_id and status = 'completed'
    ),
    'openTickets', (
      select count(*) from public.support_tickets
      where user_id = v_user_id and status in ('open', 'in_progress', 'waiting_on_user')
    ),
    'aiQuestions', (
      select coalesce(ai_questions_plan, 0) + coalesce(ai_questions_purchased, 0)
      from private.user_accounts where user_id = v_user_id
    )
  );
end;
$$;

create or replace function public.staff_list_support_tickets(
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
begin
  if not public.is_app_staff() then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;
  if v_status is not null and v_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise invalid_parameter_value using message = 'Choose a valid ticket status.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select t.id, lower(u.email) as email, t.category, t.subject, t.description,
      t.registration, t.screenshot_path as "screenshotPath", t.page_url as "pageUrl",
      t.user_agent as "userAgent", t.status, t.staff_response as "staffResponse",
      t.created_at, t.updated_at, t.responded_at as "respondedAt", t.resolved_at as "resolvedAt"
    from public.support_tickets t
    join auth.users u on u.id = t.user_id
    where v_status is null or t.status = v_status
    order by t.created_at desc
    limit v_limit
  ) item;

  return jsonb_build_object('tickets', v_items);
end;
$$;

create or replace function public.staff_update_support_ticket(
  p_ticket_id uuid,
  p_status text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_status text := trim(coalesce(p_status, ''));
  v_response text := nullif(trim(coalesce(p_response, '')), '');
begin
  if not public.is_app_staff() then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;
  if v_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise invalid_parameter_value using message = 'Choose a valid ticket status.';
  end if;
  if v_response is not null and char_length(v_response) > 2000 then
    raise invalid_parameter_value using message = 'Replies must be 2,000 characters or fewer.';
  end if;

  update public.support_tickets
  set status = v_status,
      staff_response = coalesce(v_response, staff_response),
      responded_by = case when v_response is null then responded_by else v_staff_id end,
      responded_at = case when v_response is null then responded_at else now() end,
      resolved_at = case when v_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
  where id = p_ticket_id;

  if not found then
    raise no_data_found using message = 'That support ticket no longer exists.';
  end if;

  return jsonb_build_object('updated', true, 'id', p_ticket_id, 'status', v_status);
end;
$$;

revoke execute on function public.set_account_row_updated_at() from public, anon, authenticated;
revoke execute on function public.is_app_staff() from public, anon;
revoke execute on function public.get_my_account_overview() from public, anon;
revoke execute on function public.staff_list_support_tickets(text, integer) from public, anon;
revoke execute on function public.staff_update_support_ticket(uuid, text, text) from public, anon;

grant execute on function public.is_app_staff() to authenticated;
grant execute on function public.get_my_account_overview() to authenticated;
grant execute on function public.staff_list_support_tickets(text, integer) to authenticated;
grant execute on function public.staff_update_support_ticket(uuid, text, text) to authenticated;
