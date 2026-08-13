-- Upgrade an existing CHECK A REG database with verified Stripe credit purchases.

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
  ('starter', 'Quick check', 10, 149, 'gbp'),
  ('popular', 'Driver', 30, 379, 'gbp'),
  ('best_value', 'Garage', 80, 849, 'gbp')
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

alter table private.credit_products enable row level security;
alter table private.stripe_credit_purchases enable row level security;

revoke all on table private.credit_products from public, anon, authenticated;
revoke all on table private.stripe_credit_purchases from public, anon, authenticated;

create unique index if not exists credit_transactions_purchase_id_idx
on private.credit_transactions (purchase_id)
where purchase_id is not null;

create index if not exists stripe_credit_purchases_user_created_idx
on private.stripe_credit_purchases (user_id, created_at desc);

create index if not exists stripe_credit_purchases_bundle_id_idx
on private.stripe_credit_purchases (bundle_id);

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

revoke all on function public.get_credit_purchase_history(integer) from public, anon;
revoke all on function public.fulfill_stripe_credit_purchase(uuid, text, text, text, integer, text) from public, anon, authenticated;

grant execute on function public.get_credit_purchase_history(integer) to authenticated;
grant execute on function public.fulfill_stripe_credit_purchase(uuid, text, text, text, integer, text) to service_role;
