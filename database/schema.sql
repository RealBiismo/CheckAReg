-- Run this file in the Supabase SQL editor after creating the project.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.saved_vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registration text not null check (registration ~ '^[A-Z0-9]{2,8}$'),
  make text,
  model text,
  colour text,
  tax_status text,
  tax_due_date date,
  mot_status text,
  mot_expiry_date date,
  last_mileage integer,
  saved_at timestamptz not null default now(),
  unique (user_id, registration)
);

alter table public.saved_vehicles enable row level security;

-- New Supabase projects do not automatically expose public tables to the
-- Data API. Grant only the operations used by signed-in garage users.
grant usage on schema public to authenticated;
revoke all on table public.saved_vehicles from public, anon, authenticated;
grant select, insert, update, delete on table public.saved_vehicles to authenticated;

drop policy if exists "Users can view their own saved vehicles" on public.saved_vehicles;
create policy "Users can view their own saved vehicles"
on public.saved_vehicles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can save their own vehicles" on public.saved_vehicles;
create policy "Users can save their own vehicles"
on public.saved_vehicles for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own saved vehicles" on public.saved_vehicles;
create policy "Users can update their own saved vehicles"
on public.saved_vehicles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own saved vehicles" on public.saved_vehicles;
create policy "Users can remove their own saved vehicles"
on public.saved_vehicles for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists saved_vehicles_user_saved_at_idx
on public.saved_vehicles (user_id, saved_at desc);

-- Search allowances and credits are kept outside the exposed Data API schema.
-- The public RPC functions below are the only client-facing entry points.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.user_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table if not exists private.vehicle_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registration text not null check (registration ~ '^[A-Z0-9]{2,8}$'),
  search_date date not null,
  credit_cost smallint not null default 0 check (credit_cost in (0, 2)),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists private.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists private.credit_products (
  bundle_id text primary key check (bundle_id ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (length(label) between 1 and 50),
  credits integer not null check (credits > 0 and credits <= 100000),
  amount_pence integer not null check (amount_pence > 0),
  currency text not null default 'gbp' check (currency ~ '^[a-z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private.credit_products (bundle_id, label, credits, amount_pence, currency)
values
  ('starter', 'Starter', 10, 199, 'gbp'),
  ('popular', 'Popular', 30, 499, 'gbp'),
  ('best_value', 'Best value', 70, 999, 'gbp')
on conflict (bundle_id) do update
set label = excluded.label,
    credits = excluded.credits,
    amount_pence = excluded.amount_pence,
    currency = excluded.currency,
    active = true,
    updated_at = now();

create table if not exists private.stripe_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_session_id text not null unique check (checkout_session_id ~ '^cs_'),
  payment_intent_id text unique check (payment_intent_id is null or payment_intent_id ~ '^pi_'),
  bundle_id text not null references private.credit_products(bundle_id),
  credits integer not null check (credits > 0),
  amount_pence integer not null check (amount_pence > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  created_at timestamptz not null default now()
);

alter table private.credit_transactions
  add column if not exists purchase_id uuid references private.stripe_credit_purchases(id) on delete restrict;

create table if not exists private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.push_reminder_deliveries (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  vehicle_id uuid not null references public.saved_vehicles(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('mot', 'tax')),
  due_date date not null,
  success boolean not null default false,
  error_message text,
  attempted_at timestamptz not null default now(),
  unique (subscription_id, vehicle_id, reminder_type, due_date)
);

create table if not exists private.vehicle_reminder_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.saved_vehicles(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

create table if not exists private.admin_push_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  is_broadcast boolean not null default false,
  recipient_user_count integer not null default 1 check (recipient_user_count >= 0),
  title text not null check (length(title) between 1 and 80),
  message text not null check (length(message) between 1 and 240),
  device_count integer not null default 0 check (device_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists private.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (notification_type in ('broadcast', 'mot', 'tax')),
  source_key text not null,
  title text not null check (length(title) between 1 and 100),
  message text not null check (length(message) between 1 and 500),
  url text not null default '/account.html' check (url like '/%'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, source_key)
);

alter table private.admin_push_notifications
  alter column target_user_id drop not null;

alter table private.admin_push_notifications
  add column if not exists is_broadcast boolean not null default false,
  add column if not exists recipient_user_count integer not null default 1;

alter table private.user_accounts enable row level security;
alter table private.app_admins enable row level security;
alter table private.vehicle_searches enable row level security;
alter table private.credit_transactions enable row level security;
alter table private.credit_products enable row level security;
alter table private.stripe_credit_purchases enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.push_reminder_deliveries enable row level security;
alter table private.vehicle_reminder_preferences enable row level security;
alter table private.admin_push_notifications enable row level security;
alter table private.user_notifications enable row level security;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

create index if not exists vehicle_searches_user_date_status_idx
on private.vehicle_searches (user_id, search_date, status);

create index if not exists vehicle_searches_stale_reservations_idx
on private.vehicle_searches (created_at)
where status = 'reserved';

create index if not exists credit_transactions_granted_by_idx
on private.credit_transactions (granted_by)
where granted_by is not null;

create index if not exists credit_transactions_user_id_idx
on private.credit_transactions (user_id);

create unique index if not exists credit_transactions_purchase_id_idx
on private.credit_transactions (purchase_id)
where purchase_id is not null;

create index if not exists stripe_credit_purchases_user_created_idx
on private.stripe_credit_purchases (user_id, created_at desc);

create index if not exists stripe_credit_purchases_bundle_id_idx
on private.stripe_credit_purchases (bundle_id);

create index if not exists push_subscriptions_user_id_idx
on private.push_subscriptions (user_id);

create index if not exists push_reminder_deliveries_vehicle_id_idx
on private.push_reminder_deliveries (vehicle_id);

create index if not exists vehicle_reminder_preferences_vehicle_id_idx
on private.vehicle_reminder_preferences (vehicle_id);

create index if not exists admin_push_notifications_admin_id_idx
on private.admin_push_notifications (admin_id);

create index if not exists admin_push_notifications_target_user_id_idx
on private.admin_push_notifications (target_user_id);

create index if not exists user_notifications_user_created_idx
on private.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_unread_idx
on private.user_notifications (user_id)
where read_at is null;

-- Assign administrators only through a trusted database migration after their
-- verified auth.users UUID is known. Never use browser-editable user metadata.

create or replace function public.get_search_allowance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := timezone('Europe/London', now())::date;
  v_credits integer;
  v_used integer;
  v_refund integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view your search allowance.';
  end if;

  insert into private.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from private.user_accounts
  where user_id = v_user_id
  for update;

  with stale as (
    update private.vehicle_searches
    set status = 'cancelled', finished_at = now()
    where user_id = v_user_id
      and status = 'reserved'
      and created_at < now() - interval '5 minutes'
    returning credit_cost
  )
  select coalesce(sum(credit_cost), 0)::integer into v_refund from stale;

  if v_refund > 0 then
    update private.user_accounts
    set credits = credits + v_refund,
        updated_at = now()
    where user_id = v_user_id;

    insert into private.credit_transactions (user_id, amount, reason)
    values (v_user_id, v_refund, 'expired_search_reservation_refund');
  end if;

  select credits into v_credits
  from private.user_accounts
  where user_id = v_user_id;

  select count(*)::integer into v_used
  from private.vehicle_searches
  where user_id = v_user_id
    and search_date = v_today
    and status in ('reserved', 'completed');

  return jsonb_build_object(
    'dailyLimit', 5,
    'freeUsed', least(v_used, 5),
    'freeRemaining', greatest(5 - v_used, 0),
    'credits', v_credits,
    'creditCost', 2,
    'isAdmin', exists (
      select 1 from private.app_admins where user_id = v_user_id
    )
  );
end;
$$;

create or replace function public.get_credit_purchase_history(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_purchases jsonb;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view your purchases.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', purchase.id,
    'bundleId', purchase.bundle_id,
    'credits', purchase.credits,
    'amountPence', purchase.amount_pence,
    'currency', upper(purchase.currency),
    'createdAt', purchase.created_at
  ) order by purchase.created_at desc), '[]'::jsonb)
  into v_purchases
  from (
    select id, bundle_id, credits, amount_pence, currency, created_at
    from private.stripe_credit_purchases
    where user_id = v_user_id
    order by created_at desc
    limit v_limit
  ) as purchase;

  return jsonb_build_object('purchases', v_purchases);
end;
$$;

create or replace function public.fulfill_stripe_credit_purchase(
  p_user_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text,
  p_bundle_id text,
  p_amount_pence integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product private.credit_products%rowtype;
  v_purchase_id uuid;
  v_balance integer;
begin
  if p_user_id is null
     or coalesce(p_checkout_session_id, '') !~ '^cs_[A-Za-z0-9_]+$'
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$') then
    raise invalid_parameter_value using message = 'Invalid Stripe purchase identifiers.';
  end if;

  select * into v_product
  from private.credit_products
  where bundle_id = p_bundle_id
    and active = true;

  if not found
     or v_product.amount_pence <> p_amount_pence
     or v_product.currency <> lower(coalesce(p_currency, '')) then
    raise invalid_parameter_value using message = 'The Stripe purchase does not match an active credit pack.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise foreign_key_violation using message = 'The Stripe purchase account does not exist.';
  end if;

  insert into private.stripe_credit_purchases (
    user_id,
    checkout_session_id,
    payment_intent_id,
    bundle_id,
    credits,
    amount_pence,
    currency
  ) values (
    p_user_id,
    p_checkout_session_id,
    p_payment_intent_id,
    v_product.bundle_id,
    v_product.credits,
    v_product.amount_pence,
    v_product.currency
  )
  on conflict (checkout_session_id) do nothing
  returning id into v_purchase_id;

  if v_purchase_id is null then
    select credits into v_balance
    from private.user_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'alreadyProcessed', true,
      'creditsAdded', 0,
      'credits', coalesce(v_balance, 0)
    );
  end if;

  insert into private.user_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update private.user_accounts
  set credits = credits + v_product.credits,
      updated_at = now()
  where user_id = p_user_id
  returning credits into v_balance;

  insert into private.credit_transactions (user_id, amount, reason, purchase_id)
  values (p_user_id, v_product.credits, 'stripe_purchase', v_purchase_id);

  return jsonb_build_object(
    'alreadyProcessed', false,
    'creditsAdded', v_product.credits,
    'credits', v_balance
  );
end;
$$;

create or replace function public.reserve_vehicle_search(p_registration text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration text := upper(regexp_replace(coalesce(p_registration, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := timezone('Europe/London', now())::date;
  v_credits integer;
  v_used integer;
  v_cost integer := 0;
  v_reservation_id uuid;
  v_refund integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to check a vehicle.';
  end if;

  if v_registration !~ '^[A-Z0-9]{2,8}$'
     or v_registration !~ '[A-Z]'
     or v_registration !~ '[0-9]' then
    raise invalid_parameter_value using message = 'Enter a valid UK registration number.';
  end if;

  insert into private.user_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  perform 1
  from private.user_accounts
  where user_id = v_user_id
  for update;

  with stale as (
    update private.vehicle_searches
    set status = 'cancelled', finished_at = now()
    where user_id = v_user_id
      and status = 'reserved'
      and created_at < now() - interval '5 minutes'
    returning credit_cost
  )
  select coalesce(sum(credit_cost), 0)::integer into v_refund from stale;

  if v_refund > 0 then
    update private.user_accounts
    set credits = credits + v_refund,
        updated_at = now()
    where user_id = v_user_id;

    insert into private.credit_transactions (user_id, amount, reason)
    values (v_user_id, v_refund, 'expired_search_reservation_refund');
  end if;

  select credits into v_credits
  from private.user_accounts
  where user_id = v_user_id;

  select count(*)::integer into v_used
  from private.vehicle_searches
  where user_id = v_user_id
    and search_date = v_today
    and status in ('reserved', 'completed');

  if v_used >= 5 then
    v_cost := 2;
    if v_credits < v_cost then
      return jsonb_build_object(
        'allowed', false,
        'message', 'You have used today''s 5 free searches. You need 2 credits for another search.',
        'dailyLimit', 5,
        'freeUsed', 5,
        'freeRemaining', 0,
        'credits', v_credits,
        'creditCost', 2
      );
    end if;

    update private.user_accounts
    set credits = credits - v_cost,
        updated_at = now()
    where user_id = v_user_id;

    insert into private.credit_transactions (user_id, amount, reason)
    values (v_user_id, -v_cost, 'vehicle_search');

    v_credits := v_credits - v_cost;
  end if;

  insert into private.vehicle_searches (
    user_id,
    registration,
    search_date,
    credit_cost
  )
  values (
    v_user_id,
    v_registration,
    v_today,
    v_cost
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'allowed', true,
    'reservationId', v_reservation_id,
    'dailyLimit', 5,
    'freeUsed', least(v_used + 1, 5),
    'freeRemaining', greatest(5 - (v_used + 1), 0),
    'credits', v_credits,
    'creditCost', 2,
    'chargedCredits', v_cost
  );
end;
$$;

create or replace function public.complete_vehicle_search(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to complete a vehicle search.';
  end if;

  update private.vehicle_searches
  set status = 'completed', finished_at = now()
  where id = p_reservation_id
    and user_id = v_user_id
    and status = 'reserved';

  if not found then
    raise invalid_parameter_value using message = 'The vehicle-search reservation is no longer valid.';
  end if;

  return public.get_search_allowance();
end;
$$;

create or replace function public.cancel_vehicle_search(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_refund integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to cancel a vehicle search.';
  end if;

  perform 1
  from private.user_accounts
  where user_id = v_user_id
  for update;

  update private.vehicle_searches
  set status = 'cancelled', finished_at = now()
  where id = p_reservation_id
    and user_id = v_user_id
    and status = 'reserved'
  returning credit_cost into v_refund;

  if not found then
    raise invalid_parameter_value using message = 'The vehicle-search reservation is no longer valid.';
  end if;

  if v_refund > 0 then
    update private.user_accounts
    set credits = credits + v_refund,
        updated_at = now()
    where user_id = v_user_id;

    insert into private.credit_transactions (user_id, amount, reason)
    values (v_user_id, v_refund, 'failed_vehicle_search_refund');
  end if;

  return public.get_search_allowance();
end;
$$;

create or replace function public.admin_grant_credits(p_target_email text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_balance integer;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can grant credits.';
  end if;

  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise invalid_parameter_value using message = 'Enter a credit amount between 1 and 100,000.';
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

  insert into private.user_accounts (user_id)
  values (v_target_id)
  on conflict (user_id) do nothing;

  update private.user_accounts
  set credits = credits + p_amount,
      updated_at = now()
  where user_id = v_target_id
  returning credits into v_balance;

  insert into private.credit_transactions (user_id, amount, reason, granted_by)
  values (v_target_id, p_amount, 'admin_grant', v_admin_id);

  return jsonb_build_object(
    'email', v_target_email,
    'granted', p_amount,
    'credits', v_balance
  );
end;
$$;

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
  v_credits integer;
  v_used integer;
  v_push_devices integer;
  v_today date := timezone('Europe/London', now())::date;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view user credits.';
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
  where user_id = v_target_id
    and enabled;

  return jsonb_build_object(
    'email', v_target_email,
    'credits', v_credits,
    'dailyLimit', 5,
    'freeUsed', least(v_used, 5),
    'freeRemaining', greatest(5 - v_used, 0),
    'pushDevices', v_push_devices
  );
end;
$$;

create or replace function public.admin_set_user_credits(p_target_email text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_previous integer;
  v_reason text;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can set user credits.';
  end if;

  if p_amount is null or p_amount < 0 or p_amount > 100000 then
    raise invalid_parameter_value using message = 'Enter a credit balance between 0 and 100,000.';
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

  insert into private.user_accounts (user_id)
  values (v_target_id)
  on conflict (user_id) do nothing;

  select credits into v_previous
  from private.user_accounts
  where user_id = v_target_id
  for update;

  update private.user_accounts
  set credits = p_amount,
      updated_at = now()
  where user_id = v_target_id;

  if p_amount <> v_previous then
    v_reason := case when p_amount = 0 then 'admin_reset' else 'admin_set' end;
    insert into private.credit_transactions (user_id, amount, reason, granted_by)
    values (v_target_id, p_amount - v_previous, v_reason, v_admin_id);
  end if;

  return jsonb_build_object(
    'email', v_target_email,
    'previousCredits', v_previous,
    'credits', p_amount,
    'changedBy', p_amount - v_previous
  );
end;
$$;

create or replace function public.admin_prepare_push_notification(
  p_target_email text,
  p_title text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_id uuid;
  v_target_email text;
  v_title text := trim(coalesce(p_title, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_notification_id uuid;
  v_subscriptions jsonb;
  v_device_count integer;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can send push notifications.';
  end if;

  if length(v_title) not between 1 and 80 then
    raise invalid_parameter_value using message = 'Enter a notification title between 1 and 80 characters.';
  end if;

  if length(v_message) not between 1 and 240 then
    raise invalid_parameter_value using message = 'Enter a notification message between 1 and 240 characters.';
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

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'subscriptionId', id,
      'endpoint', endpoint,
      'p256dh', p256dh,
      'authKey', auth_key
    ) order by created_at),
    '[]'::jsonb
  )
  into v_subscriptions
  from private.push_subscriptions
  where user_id = v_target_id
    and enabled;

  v_device_count := jsonb_array_length(v_subscriptions);

  insert into private.admin_push_notifications (
    admin_id,
    target_user_id,
    title,
    message,
    device_count
  )
  values (
    v_admin_id,
    v_target_id,
    v_title,
    v_message,
    v_device_count
  )
  returning id into v_notification_id;

  return jsonb_build_object(
    'notificationId', v_notification_id,
    'email', v_target_email,
    'title', v_title,
    'message', v_message,
    'deviceCount', v_device_count,
    'subscriptions', v_subscriptions
  );
end;
$$;

create or replace function public.admin_get_push_audience()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_accounts integer;
  v_devices integer;
  v_recipients integer;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view the push audience.';
  end if;

  select count(distinct user_id)::integer, count(*)::integer
  into v_accounts, v_devices
  from private.push_subscriptions
  where enabled;

  select count(*)::integer into v_recipients
  from auth.users where email_confirmed_at is not null;

  return jsonb_build_object(
    'accounts', v_accounts,
    'devices', v_devices,
    'recipients', v_recipients
  );
end;
$$;

create or replace function public.admin_prepare_broadcast_push_notification(
  p_title text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_notification_id uuid;
  v_subscriptions jsonb;
  v_account_count integer;
  v_recipient_count integer;
  v_device_count integer;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can send broadcast push notifications.';
  end if;

  if length(v_title) not between 1 and 80 then
    raise invalid_parameter_value using message = 'Enter a notification title between 1 and 80 characters.';
  end if;

  if length(v_message) not between 1 and 240 then
    raise invalid_parameter_value using message = 'Enter a notification message between 1 and 240 characters.';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'subscriptionId', id,
      'endpoint', endpoint,
      'p256dh', p256dh,
      'authKey', auth_key
    ) order by created_at),
    '[]'::jsonb
  ), count(distinct user_id)::integer
  into v_subscriptions, v_account_count
  from private.push_subscriptions
  where enabled;

  v_device_count := jsonb_array_length(v_subscriptions);

  select count(*)::integer
  into v_recipient_count
  from auth.users
  where email_confirmed_at is not null;

  insert into private.admin_push_notifications (
    admin_id,
    target_user_id,
    is_broadcast,
    recipient_user_count,
    title,
    message,
    device_count
  )
  values (
    v_admin_id,
    null,
    true,
    v_recipient_count,
    v_title,
    v_message,
    v_device_count
  )
  returning id into v_notification_id;

  insert into private.user_notifications (
    user_id, notification_type, source_key, title, message, url
  )
  select
    id,
    'broadcast',
    'broadcast:' || v_notification_id::text,
    v_title,
    v_message,
    '/account.html?notifications=1'
  from auth.users
  where email_confirmed_at is not null
  on conflict (user_id, source_key) do nothing;

  return jsonb_build_object(
    'notificationId', v_notification_id,
    'title', v_title,
    'message', v_message,
    'accountCount', v_account_count,
    'recipientAccountCount', v_recipient_count,
    'deviceCount', v_device_count,
    'subscriptions', v_subscriptions
  );
end;
$$;

create or replace function public.admin_complete_push_notification(
  p_notification_id uuid,
  p_sent integer,
  p_failed integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_device_count integer;
begin
  if v_admin_id is null or not exists (
    select 1 from private.app_admins where user_id = v_admin_id
  ) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can complete push notifications.';
  end if;

  select device_count into v_device_count
  from private.admin_push_notifications
  where id = p_notification_id
    and admin_id = v_admin_id
  for update;

  if v_device_count is null then
    raise no_data_found using message = 'That notification request was not found.';
  end if;

  if p_sent is null or p_failed is null or p_sent < 0 or p_failed < 0
     or p_sent + p_failed > v_device_count then
    raise invalid_parameter_value using message = 'Invalid notification delivery totals.';
  end if;

  update private.admin_push_notifications
  set sent_count = p_sent,
      failed_count = p_failed,
      completed_at = now()
  where id = p_notification_id;

  return jsonb_build_object(
    'notificationId', p_notification_id,
    'devices', v_device_count,
    'sent', p_sent,
    'failed', p_failed
  );
end;
$$;

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subscription_id uuid;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to enable vehicle reminders.';
  end if;

  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048
     or p_p256dh is null or length(p_p256dh) not between 40 and 256
     or p_auth is null or length(p_auth) not between 8 and 128 then
    raise invalid_parameter_value using message = 'That notification subscription is invalid.';
  end if;

  insert into private.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    enabled
  )
  values (
    v_user_id,
    p_endpoint,
    p_p256dh,
    p_auth,
    left(p_user_agent, 500),
    true
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      user_agent = excluded.user_agent,
      enabled = true,
      updated_at = now()
  returning id into v_subscription_id;

  return jsonb_build_object('enabled', true, 'subscriptionId', v_subscription_id);
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to disable vehicle reminders.';
  end if;

  delete from private.push_subscriptions
  where user_id = v_user_id
    and endpoint = p_endpoint;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('enabled', false, 'removed', v_deleted > 0);
end;
$$;

create or replace function public.get_vehicle_reminder_preferences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_vehicles jsonb;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view vehicle reminders.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicleId', vehicle.id,
    'registration', vehicle.registration,
    'make', vehicle.make,
    'model', vehicle.model,
    'enabled', coalesce(preference.enabled, false)
  ) order by vehicle.saved_at desc), '[]'::jsonb)
  into v_vehicles
  from public.saved_vehicles as vehicle
  left join private.vehicle_reminder_preferences as preference
    on preference.user_id = v_user_id
   and preference.vehicle_id = vehicle.id
  where vehicle.user_id = v_user_id;

  return jsonb_build_object('vehicles', v_vehicles);
end;
$$;

create or replace function public.set_vehicle_reminder_preference(
  p_vehicle_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_registration text;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to manage vehicle reminders.';
  end if;

  if p_enabled is null then
    raise invalid_parameter_value using message = 'Choose whether reminders are enabled.';
  end if;

  select registration into v_registration
  from public.saved_vehicles
  where id = p_vehicle_id
    and user_id = v_user_id;

  if v_registration is null then
    raise no_data_found using message = 'That saved vehicle was not found.';
  end if;

  insert into private.vehicle_reminder_preferences (user_id, vehicle_id, enabled)
  values (v_user_id, p_vehicle_id, p_enabled)
  on conflict (user_id, vehicle_id) do update
  set enabled = excluded.enabled,
      updated_at = now();

  return jsonb_build_object(
    'vehicleId', p_vehicle_id,
    'registration', v_registration,
    'enabled', p_enabled
  );
end;
$$;

create or replace function public.get_due_push_reminders(p_cron_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_secret text;
  v_today date := timezone('Europe/London', now())::date;
  v_reminders jsonb;
begin
  select decrypted_secret
  into v_expected_secret
  from vault.decrypted_secrets
  where name = 'biismo_reminder_cron_secret'
  limit 1;

  if v_expected_secret is null or p_cron_secret is distinct from v_expected_secret then
    raise insufficient_privilege using message = 'Invalid reminder job credentials.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(due)), '[]'::jsonb)
  into v_reminders
  from (
    select
      subscription.id as "subscriptionId",
      vehicle.id as "vehicleId",
      due.reminder_type as "reminderType",
      due.due_date as "dueDate",
      (due.due_date - v_today) as "daysRemaining",
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth_key as "authKey",
      vehicle.registration,
      vehicle.make,
      vehicle.model
    from private.push_subscriptions as subscription
    join public.saved_vehicles as vehicle
      on vehicle.user_id = subscription.user_id
    join private.vehicle_reminder_preferences as preference
      on preference.user_id = subscription.user_id
     and preference.vehicle_id = vehicle.id
     and preference.enabled
    cross join lateral (
      values
        ('mot'::text, vehicle.mot_expiry_date),
        ('tax'::text, vehicle.tax_due_date)
    ) as due(reminder_type, due_date)
    where subscription.enabled
      and due.due_date is not null
      and (due.due_date - v_today) in (30, 14, 7, 1, 0)
      and not exists (
        select 1
        from private.push_reminder_deliveries as delivery
        where delivery.subscription_id = subscription.id
          and delivery.vehicle_id = vehicle.id
          and delivery.reminder_type = due.reminder_type
          and delivery.due_date = due.due_date
          and delivery.success
      )
    order by due.due_date, vehicle.registration
    limit 500
  ) as due;

  return jsonb_build_object('reminders', v_reminders);
end;
$$;

create or replace function public.record_push_reminder(
  p_cron_secret text,
  p_subscription_id uuid,
  p_vehicle_id uuid,
  p_reminder_type text,
  p_due_date date,
  p_success boolean,
  p_disable_subscription boolean default false,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_secret text;
  v_user_id uuid;
  v_registration text;
  v_vehicle_name text;
  v_days integer;
  v_due_text text;
begin
  select decrypted_secret
  into v_expected_secret
  from vault.decrypted_secrets
  where name = 'biismo_reminder_cron_secret'
  limit 1;

  if v_expected_secret is null or p_cron_secret is distinct from v_expected_secret then
    raise insufficient_privilege using message = 'Invalid reminder job credentials.';
  end if;

  if p_reminder_type not in ('mot', 'tax') then
    raise invalid_parameter_value using message = 'Invalid reminder type.';
  end if;

  insert into private.push_reminder_deliveries (
    subscription_id,
    vehicle_id,
    reminder_type,
    due_date,
    success,
    error_message
  )
  select
    p_subscription_id,
    p_vehicle_id,
    p_reminder_type,
    p_due_date,
    p_success,
    left(p_error, 500)
  from private.push_subscriptions as subscription
  join public.saved_vehicles as vehicle
    on vehicle.id = p_vehicle_id
   and vehicle.user_id = subscription.user_id
  where subscription.id = p_subscription_id
  on conflict (subscription_id, vehicle_id, reminder_type, due_date) do update
  set success = excluded.success,
      error_message = excluded.error_message,
      attempted_at = now();

  if p_success then
    select subscription.user_id, vehicle.registration,
           trim(concat_ws(' ', vehicle.make, vehicle.model))
    into v_user_id, v_registration, v_vehicle_name
    from private.push_subscriptions as subscription
    join public.saved_vehicles as vehicle
      on vehicle.id = p_vehicle_id and vehicle.user_id = subscription.user_id
    where subscription.id = p_subscription_id;

    if v_user_id is not null then
      v_days := p_due_date - timezone('Europe/London', now())::date;
      v_due_text := case
        when v_days = 0 then 'is due today'
        when v_days = 1 then 'is due tomorrow'
        else 'is due in ' || v_days || ' days'
      end;

      insert into private.user_notifications (
        user_id, notification_type, source_key, title, message, url
      ) values (
        v_user_id,
        p_reminder_type,
        'reminder:' || p_vehicle_id::text || ':' || p_reminder_type || ':' || p_due_date::text,
        upper(p_reminder_type) || ' reminder · ' || v_registration,
        coalesce(nullif(v_vehicle_name, ''), 'Your vehicle') || ' ' || upper(p_reminder_type) || ' ' || v_due_text || '.',
        '/account.html?vehicle=' || v_registration
      ) on conflict (user_id, source_key) do nothing;
    end if;
  end if;

  if p_disable_subscription then
    update private.push_subscriptions
    set enabled = false,
        updated_at = now()
    where id = p_subscription_id;
  end if;

  return jsonb_build_object('recorded', found);
end;
$$;

create or replace function public.get_user_notifications(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
  v_unread integer;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Sign in to view notifications.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select id, notification_type as type, title, message, url, created_at, read_at
    from private.user_notifications
    where user_id = v_user_id
    order by created_at desc
    limit v_limit
  ) as item;

  select count(*)::integer into v_unread
  from private.user_notifications
  where user_id = v_user_id and read_at is null;

  return jsonb_build_object('notifications', v_items, 'unreadCount', v_unread);
end;
$$;

create or replace function public.set_user_notification_read(p_notification_id uuid, p_read boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise insufficient_privilege using message = 'Sign in to update notifications.'; end if;
  update private.user_notifications
  set read_at = case when coalesce(p_read, true) then now() else null end
  where id = p_notification_id and user_id = v_user_id;
  if not found then raise no_data_found using message = 'That notification was not found.'; end if;
  return jsonb_build_object('updated', true);
end;
$$;

create or replace function public.mark_all_user_notifications_read()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_count integer;
begin
  if v_user_id is null then raise insufficient_privilege using message = 'Sign in to update notifications.'; end if;
  update private.user_notifications set read_at = now()
  where user_id = v_user_id and read_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('updated', v_count);
end;
$$;

create or replace function public.delete_user_notification(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise insufficient_privilege using message = 'Sign in to delete notifications.'; end if;
  delete from private.user_notifications where id = p_notification_id and user_id = v_user_id;
  if not found then raise no_data_found using message = 'That notification was not found.'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;

create or replace function public.admin_get_broadcast_history(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin_id uuid := auth.uid(); v_items jsonb;
begin
  if v_admin_id is null or not exists (select 1 from private.app_admins where user_id = v_admin_id) then
    raise insufficient_privilege using message = 'Only the CHECK A REG admin can view broadcast history.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc), '[]'::jsonb)
  into v_items from (
    select id, title, message, recipient_user_count as recipients, device_count as devices,
           sent_count as sent, failed_count as failed, created_at, completed_at
    from private.admin_push_notifications
    where is_broadcast
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ) item;
  return jsonb_build_object('broadcasts', v_items);
end;
$$;

create or replace function public.export_account_emails(p_export_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_expected_secret text; v_accounts jsonb;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets where name = 'biismo_email_export_secret' limit 1;
  if v_expected_secret is null or p_export_secret is distinct from v_expected_secret then
    raise insufficient_privilege using message = 'Invalid email export credentials.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', lower(email), 'createdAt', created_at,
    'confirmed', email_confirmed_at is not null
  ) order by created_at), '[]'::jsonb)
  into v_accounts from auth.users where email is not null;
  return jsonb_build_object('accounts', v_accounts, 'generatedAt', now());
end;
$$;

create or replace function private.dispatch_due_push_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dispatch_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_dispatch_url
  from vault.decrypted_secrets
  where name = 'biismo_reminder_dispatch_url'
  limit 1;

  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'biismo_reminder_cron_secret'
  limit 1;

  if v_dispatch_url is null or v_cron_secret is null then
    raise exception 'CHECK A REG reminder Vault secrets are not configured.';
  end if;

  select net.http_post(
    url := v_dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', v_cron_secret
    ),
    body := jsonb_build_object('scheduledAt', now()),
    timeout_milliseconds := 30000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.get_search_allowance() from public, anon;
revoke all on function public.get_credit_purchase_history(integer) from public, anon;
revoke all on function public.fulfill_stripe_credit_purchase(uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.reserve_vehicle_search(text) from public, anon;
revoke all on function public.complete_vehicle_search(uuid) from public, anon;
revoke all on function public.cancel_vehicle_search(uuid) from public, anon;
revoke all on function public.admin_grant_credits(text, integer) from public, anon;
revoke all on function public.admin_get_user_credits(text) from public, anon;
revoke all on function public.admin_set_user_credits(text, integer) from public, anon;
revoke all on function public.admin_prepare_push_notification(text, text, text) from public, anon;
revoke all on function public.admin_get_push_audience() from public, anon;
revoke all on function public.admin_prepare_broadcast_push_notification(text, text) from public, anon;
revoke all on function public.admin_complete_push_notification(uuid, integer, integer) from public, anon;
revoke all on function public.upsert_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.get_vehicle_reminder_preferences() from public, anon;
revoke all on function public.set_vehicle_reminder_preference(uuid, boolean) from public, anon;
revoke all on function public.get_due_push_reminders(text) from public, authenticated;
revoke all on function public.record_push_reminder(text, uuid, uuid, text, date, boolean, boolean, text) from public, authenticated;
revoke all on function public.get_user_notifications(integer) from public, anon;
revoke all on function public.set_user_notification_read(uuid, boolean) from public, anon;
revoke all on function public.mark_all_user_notifications_read() from public, anon;
revoke all on function public.delete_user_notification(uuid) from public, anon;
revoke all on function public.admin_get_broadcast_history(integer) from public, anon;
revoke all on function public.export_account_emails(text) from public, authenticated;
revoke all on function private.dispatch_due_push_reminders() from public, anon, authenticated;

grant execute on function public.get_search_allowance() to authenticated;
grant execute on function public.get_credit_purchase_history(integer) to authenticated;
grant execute on function public.fulfill_stripe_credit_purchase(uuid, text, text, text, integer, text) to service_role;
grant execute on function public.reserve_vehicle_search(text) to authenticated;
grant execute on function public.complete_vehicle_search(uuid) to authenticated;
grant execute on function public.cancel_vehicle_search(uuid) to authenticated;
grant execute on function public.admin_grant_credits(text, integer) to authenticated;
grant execute on function public.admin_get_user_credits(text) to authenticated;
grant execute on function public.admin_set_user_credits(text, integer) to authenticated;
grant execute on function public.admin_prepare_push_notification(text, text, text) to authenticated;
grant execute on function public.admin_get_push_audience() to authenticated;
grant execute on function public.admin_prepare_broadcast_push_notification(text, text) to authenticated;
grant execute on function public.admin_complete_push_notification(uuid, integer, integer) to authenticated;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.get_vehicle_reminder_preferences() to authenticated;
grant execute on function public.set_vehicle_reminder_preference(uuid, boolean) to authenticated;
grant execute on function public.get_due_push_reminders(text) to anon;
grant execute on function public.record_push_reminder(text, uuid, uuid, text, date, boolean, boolean, text) to anon;
grant execute on function public.get_user_notifications(integer) to authenticated;
grant execute on function public.set_user_notification_read(uuid, boolean) to authenticated;
grant execute on function public.mark_all_user_notifications_read() to authenticated;
grant execute on function public.delete_user_notification(uuid) to authenticated;
grant execute on function public.admin_get_broadcast_history(integer) to authenticated;
grant execute on function public.export_account_emails(text) to anon;
