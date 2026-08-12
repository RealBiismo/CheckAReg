# Check A Reg

Check A Reg is an independently branded clone of the BiismoReg application. It preserves the vehicle-check, account, Garage, credits, payments, notifications, administration and AI feature architecture while applying the Check A Reg visual system.

## Isolation rule

This repository must use its own hosting service, domain and environment variables. Do not copy BiismoReg's production Supabase, Stripe, DVLA, MOT, push or OpenAI secrets into this deployment. Create separate development resources first, then promote them only after testing.

BIISMO REG is a UK vehicle checker built with Node.js, Express and browser-native JavaScript. It combines official DVLA vehicle-enquiry data with DVSA MOT history and presents tax, MOT, mileage, emissions and vehicle details in a mobile-friendly report.

## Features

- Official DVLA vehicle and tax details
- DVSA MOT history, mileage and defect grouping
- Calculated mileage trends and a clearly labelled ULEZ estimate
- Printable reports and installable web-app groundwork
- Registration validation, upstream timeouts and API rate limiting
- Server-side API credentials with no token or vehicle-response logging
- Verified email/password accounts and Google sign-in through Supabase Auth
- A private saved-vehicle garage protected with Row Level Security
- Five free successful vehicle checks per account each UK calendar day
- Credit-funded extra checks and an audited admin console for lookups, grants, exact balances and resets
- One-off Stripe credit packs with signed-webhook fulfilment and duplicate-payment protection
- Colour-coded MOT and tax countdowns in the saved-vehicle garage
- Free opt-in push reminders for chosen garage registrations 30, 14, 7 and 1 day before expiry, plus the due date
- Confirmed admin broadcast push notifications to every opted-in account, with a private delivery audit record
- A branded notification consent prompt before the browser permission request
- A private in-app notification centre with unread counts, mark-read controls and retained MOT/tax and broadcast history
- Admin broadcast history with recipient, device, sent and failed totals
- A private Google Sheets account export that refreshes automatically

## Requirements

- Node.js 18.17 or newer
- DVLA Vehicle Enquiry API credentials
- DVSA MOT History API credentials
- A Supabase project for authentication and saved vehicles
- A Stripe account to accept credit-pack payments

## Local setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and enter the API credentials.
3. Create a Supabase project and run `database/schema.sql` in its SQL editor. The script explicitly grants authenticated Data API access, applies per-user Row Level Security, and installs the private daily-search, credit and push-reminder functions. Assign the owner in `private.app_admins` through a trusted database migration after verifying their `auth.users` UUID; never authorize from browser-editable user metadata.
4. Add the project URL and public anon/publishable key to `.env`.
5. In Supabase Auth settings, keep email confirmation enabled and add your production URL plus `http://localhost:3000/**` to the redirect allow list.
6. To enable Google login, create a Google web OAuth client and add its client ID and secret to the Supabase Google provider settings.
7. Run `npm start`.
8. Open `http://localhost:3000`.

## Push reminder setup

Generate one VAPID key pair and a long random reminder secret. Configure the server with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `REMINDER_CRON_SECRET`. Store the same reminder secret and the dispatch URL in Supabase Vault under `biismo_reminder_cron_secret` and `biismo_reminder_dispatch_url`. The dispatch URL should end in `/api/cron/reminders`.

After the Vault values exist, schedule the daily job through Supabase Cron:

```sql
select cron.schedule(
  'biismo-daily-vehicle-reminders',
  '0 9 * * *',
  $$select private.dispatch_due_push_reminders();$$
);
```

Cron uses UTC, so this runs at 09:00 UTC. Users enable notifications per device and then choose which saved registrations receive expiry reminders. Reminder preferences, subscriptions, delivery records and admin notification audits remain in the private schema and are only reachable through authenticated or secret-checked functions.

Supabase setup references:

- [Email signup](https://supabase.com/docs/reference/javascript/auth-signup)
- [Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

The Supabase anon/publishable key is designed for browser use. Never expose a Supabase secret/service-role key in browser code; keep it only in Render's server environment.

## Stripe credit-store setup

The store uses Stripe-hosted Checkout. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY` and `APP_BASE_URL` only in the Render service environment. The Supabase secret key must never be placed in browser code or a public environment variable.

In Stripe Workbench, add a webhook destination for `https://your-domain.example/api/stripe/webhook` and subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Start with Stripe test-mode keys and a test-mode webhook secret. After a successful test purchase confirms that the balance and purchase history update exactly once, replace both Stripe values with live-mode credentials.

The packs and their verified database values are £1.99/10 credits, £4.99/30 credits and £9.99/70 credits. Stripe metadata is never trusted on its own: the signed event, authenticated account UUID, paid amount, currency and active database product must all match before credits are granted.

The Google Sheets `Accounts` tab uses `IMPORTDATA` against the private `/api/account-export/:secret.csv` feed. Keep the matching `EMAIL_EXPORT_SECRET` only in Render and Supabase Vault (`biismo_email_export_secret`). Google controls external-data refresh timing, so new signups appear automatically but may not be immediate.

Do not commit `.env`; it is ignored by Git.

## Tests

Run `npm test`.

## Data accuracy

Vehicle, tax and MOT records come from the configured government APIs. ULEZ and mileage insights are calculated estimates and should be independently confirmed before making travel or purchasing decisions.
