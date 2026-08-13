-- Keep Stripe checkout prices and server-side fulfilment validation in sync.
insert into private.credit_products (bundle_id, label, credits, amount_pence, currency, active)
values
  ('starter', 'Quick check', 10, 149, 'gbp', true),
  ('popular', 'Driver', 30, 379, 'gbp', true),
  ('best_value', 'Garage', 80, 849, 'gbp', true)
on conflict (bundle_id) do update
set label = excluded.label,
    credits = excluded.credits,
    amount_pence = excluded.amount_pence,
    currency = excluded.currency,
    active = excluded.active,
    updated_at = now();
