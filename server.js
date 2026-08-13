import "dotenv/config";

import express from "express";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import webpush from "web-push";

import {
  buildVehicleResponse,
  normalizeRegistration,
  ValidationError,
} from "./lib/vehicle.js";

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
  dvlaApiKey: process.env.DVLA_API_KEY,
  motClientId: process.env.MOT_CLIENT_ID,
  motClientSecret: process.env.MOT_CLIENT_SECRET,
  motApiKey: process.env.MOT_API_KEY,
  motScope: process.env.MOT_SCOPE,
  motTokenUrl: process.env.MOT_TOKEN_URL,
};

const authConfig = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const blockedLegacyHosts = ["biismoreg.com", "biismoreg-com.onrender.com"];
const blockedLegacySupabaseRef = "irpzvslnfgwyjwouissi";
const configuredAppUrl = String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").toLowerCase();
const configuredSupabaseUrl = String(authConfig.supabaseUrl || "").toLowerCase();

if (blockedLegacyHosts.some((host) => configuredAppUrl.includes(host))) {
  throw new Error("Check A Reg isolation blocked a legacy hosting URL. Use a separate APP_BASE_URL.");
}
if (configuredSupabaseUrl.includes(blockedLegacySupabaseRef)) {
  throw new Error("Check A Reg isolation blocked the legacy Supabase project. Create a separate Supabase project.");
}

const stripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  appBaseUrl: process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL,
};

const creditBundles = Object.freeze([
  Object.freeze({ id: "starter", credits: 10, amountPence: 149, label: "Quick check" }),
  Object.freeze({ id: "popular", credits: 30, amountPence: 379, label: "Driver" }),
  Object.freeze({ id: "best_value", credits: 80, amountPence: 849, label: "Garage" }),
]);
const creditBundlesById = new Map(creditBundles.map((bundle) => [bundle.id, bundle]));
const plusPlan = Object.freeze({
  id: "biismo_plus",
  label: "CHECK A REG+",
  amountPence: 599,
  currency: "gbp",
  interval: "month",
  creditsMonthly: 60,
  aiQuestionsMonthly: 150,
  garageLimit: 6,
});
const aiQuestionPack = Object.freeze({ creditsCost: 4, questions: 10 });
const stripe = stripeConfig.secretKey
  ? new Stripe(stripeConfig.secretKey, { maxNetworkRetries: 2, timeout: 10_000 })
  : null;

const pushConfig = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT || "mailto:checkareg@example.com",
  cronSecret: process.env.REMINDER_CRON_SECRET,
};
const emailExportSecret = process.env.EMAIL_EXPORT_SECRET;

if (pushConfig.publicKey && pushConfig.privateKey) {
  webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);
}

let cachedMotToken = null;
let motTokenExpiry = 0;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json", limit: "100kb" }),
  handleStripeWebhook
);
app.use(express.json({ limit: "10kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob: https://*.supabase.co https://files.catbox.moe https://*.googleusercontent.com; style-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://accounts.google.com; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(express.static("public"));

const vehicleCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many vehicle checks. Please try again shortly." },
});

const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many admin requests. Please try again shortly." },
});

const pushActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many reminder requests. Please try again shortly." },
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many checkout attempts. Please try again shortly." },
});

function assertConfigured() {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    const error = new Error("The vehicle data service is not configured.");
    error.statusCode = 503;
    error.logMessage = `Missing environment settings: ${missing.join(", ")}`;
    throw error;
  }
}

async function readJsonResponse(response, serviceName) {
  const rawBody = await response.text();
  let data = {};

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      const error = new Error(`${serviceName} returned an invalid response.`);
      error.statusCode = 502;
      error.logMessage = `${serviceName} returned non-JSON data (${response.status}).`;
      throw error;
    }
  }

  return data;
}

function brandUserMessage(value) {
  return String(value || "")
    .replace(/BiismoReg/gi, "CheckA Reg")
    .replace(/BIISMO REG\+/gi, "CheckA Reg+")
    .replace(/BIISMO REG/gi, "CheckA Reg")
    .replace(/Biismo AI/gi, "CheckA Reg AI")
    .replace(/BIISMO/gi, "CheckA Reg");
}

function getBearerToken(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    const error = new Error("Sign in to check a vehicle.");
    error.statusCode = 401;
    throw error;
  }

  return match[1];
}

function assertAuthConfigured() {
  if (!authConfig.supabaseUrl || !authConfig.supabaseAnonKey) {
    const error = new Error("Account services are not configured yet.");
    error.statusCode = 503;
    throw error;
  }
}

async function authenticateRequest(req) {
  const token = getBearerToken(req);
  assertAuthConfigured();

  let response;
  try {
    response = await fetch(`${authConfig.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: authConfig.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    const error = new Error("Account services could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const user = await readJsonResponse(response, "Supabase Auth");
  if (!response.ok || !user?.id) {
    const error = new Error("Your session has expired. Sign in again.");
    error.statusCode = 401;
    throw error;
  }

  return { token, user };
}

async function callSupabaseRpc(token, functionName, parameters = {}) {
  assertAuthConfigured();

  let response;
  try {
    response = await fetch(
      `${authConfig.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        headers: {
          apikey: authConfig.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(8_000),
      }
    );
  } catch (cause) {
    const error = new Error("Account services could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const data = await readJsonResponse(response, "Supabase Data API");
  if (!response.ok) {
    const message = brandUserMessage(
      data?.message || "The account operation could not be completed."
    );
    const error = new Error(message);
    error.statusCode = response.status === 401 || response.status === 403 ? response.status : 502;
    if (message.includes("No verified CheckA Reg account")) error.statusCode = 404;
    if (message.includes("credit amount")) error.statusCode = 400;
    if (message.includes("credit balance")) error.statusCode = 400;
    if (message.includes("notification title")) error.statusCode = 400;
    if (message.includes("notification message")) error.statusCode = 400;
    if (message.includes("delivery totals")) error.statusCode = 400;
    if (message.includes("saved vehicle was not found")) error.statusCode = 404;
    if (message.includes("4 credits") || message.includes("AI Mechanic questions")) error.statusCode = 400;
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

async function callSupabaseAdminRpc(functionName, parameters = {}) {
  assertAuthConfigured();
  const secretKey = authConfig.supabaseSecretKey;
  if (!secretKey) {
    const error = new Error("Secure credit fulfilment is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  const headers = {
    apikey: secretKey,
    "Content-Type": "application/json",
  };
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  let response;
  try {
    response = await fetch(
      `${authConfig.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(8_000),
      }
    );
  } catch (cause) {
    const error = new Error("Account services could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const data = await readJsonResponse(response, "Supabase Data API");
  if (!response.ok) {
    const error = new Error(
      brandUserMessage(data?.message || "The credit purchase could not be recorded.")
    );
    error.statusCode = response.status === 401 || response.status === 403 ? response.status : 502;
    throw error;
  }
  return Array.isArray(data) ? data[0] : data;
}

function stripeIsConfigured() {
  return Boolean(
    stripe &&
      stripeConfig.webhookSecret &&
      authConfig.supabaseUrl &&
      authConfig.supabaseSecretKey
  );
}

function publicAppUrl(req) {
  const candidate = stripeConfig.appBaseUrl || `${req.protocol}://${req.get("host")}`;
  const url = new URL(candidate);
  if (!(["https:", "http:"].includes(url.protocol))) throw new Error("Invalid app URL.");
  return url.origin;
}

function periodEndIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

async function handleStripeWebhook(req, res) {
  if (!stripeIsConfigured()) {
    return res.status(503).json({ error: "Credit purchases are not configured yet." });
  }

  const signature = req.get("stripe-signature");
  if (!signature) return res.status(400).json({ error: "Missing Stripe signature." });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, stripeConfig.webhookSecret);
  } catch (error) {
    console.error(`Stripe webhook signature rejected: ${error.message}`);
    return res.status(400).json({ error: "Invalid Stripe signature." });
  }

  try {
    if (["customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const subscription = event.data.object;
      const subscriptionId = String(subscription.id || "");
      if (subscriptionId.startsWith("sub_")) {
        await callSupabaseAdminRpc("set_biismo_plus_subscription_status", {
          p_subscription_id: subscriptionId,
          p_status: String(subscription.status || (event.type.endsWith("deleted") ? "canceled" : "inactive")),
          p_period_end: periodEndIso(subscription.current_period_end),
        });
      }
      return res.json({ received: true });
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      if (String(invoice.billing_reason || "") === "subscription_cycle") {
        const subscriptionId = typeof invoice.subscription === "string"
          ? invoice.subscription
          : String(invoice.parent?.subscription_details?.subscription || "");
        if (subscriptionId.startsWith("sub_")) {
          const periodEnd = periodEndIso(invoice.lines?.data?.[0]?.period?.end);
          await callSupabaseAdminRpc("renew_biismo_plus", {
            p_subscription_id: subscriptionId,
            p_grant_key: `invoice:${invoice.id}`,
            p_period_end: periodEnd,
          });
        }
      }
      return res.json({ received: true });
    }

    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      return res.json({ received: true });
    }

    const session = event.data.object;
    if (session.payment_status !== "paid") return res.json({ received: true });

    const userId = String(session.metadata?.user_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || session.client_reference_id !== userId) {
      return res.status(400).json({ error: "Invalid purchase account." });
    }

    if (session.mode === "subscription" && String(session.metadata?.plan_id || "") === plusPlan.id) {
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";
      const customerId = typeof session.customer === "string" ? session.customer : "";
      if (!subscriptionId.startsWith("sub_") || !customerId.startsWith("cus_") || session.amount_total !== plusPlan.amountPence || String(session.currency || "").toLowerCase() !== plusPlan.currency) {
        return res.status(400).json({ error: "Invalid CHECK A REG+ purchase." });
      }
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await callSupabaseAdminRpc("activate_biismo_plus", {
        p_user_id: userId,
        p_customer_id: customerId,
        p_subscription_id: subscriptionId,
        p_grant_key: `checkout:${session.id}`,
        p_period_end: periodEndIso(subscription.current_period_end),
      });
      return res.json({ received: true });
    }

    const bundleId = String(session.metadata?.bundle_id || "");
    const bundle = creditBundlesById.get(bundleId);
    const currency = String(session.currency || "").toLowerCase();
    if (!bundle || session.amount_total !== bundle.amountPence || currency !== "gbp") {
      console.error(`Stripe checkout ${session.id} failed CHECK A REG fulfilment validation.`);
      return res.status(400).json({ error: "Invalid credit purchase." });
    }

    await callSupabaseAdminRpc("fulfill_stripe_credit_purchase", {
      p_user_id: userId,
      p_checkout_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
      p_bundle_id: bundle.id,
      p_amount_pence: session.amount_total,
      p_currency: currency,
    });
    return res.json({ received: true });
  } catch (error) {
    console.error(`Stripe fulfilment failed: ${error.message}`);
    return res.status(500).json({ error: "Purchase fulfilment failed." });
  }
}

function pushIsConfigured() {
  return Boolean(pushConfig.publicKey && pushConfig.privateKey && pushConfig.cronSecret);
}

function pushKeysAreConfigured() {
  return Boolean(pushConfig.publicKey && pushConfig.privateKey);
}

function secretsMatch(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return (
    receivedBuffer.length === expectedBuffer.length &&
    receivedBuffer.length > 0 &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function validPushSubscription(subscription) {
  return Boolean(
    subscription &&
      typeof subscription.endpoint === "string" &&
      subscription.endpoint.startsWith("https://") &&
      subscription.endpoint.length <= 2048 &&
      typeof subscription.keys?.p256dh === "string" &&
      subscription.keys.p256dh.length >= 40 &&
      subscription.keys.p256dh.length <= 256 &&
      typeof subscription.keys?.auth === "string" &&
      subscription.keys.auth.length >= 8 &&
      subscription.keys.auth.length <= 128
  );
}

function reminderPayload(reminder) {
  const days = Number(reminder.daysRemaining);
  const dueText =
    days === 0
      ? "is due today"
      : days === 1
        ? "is due tomorrow"
        : `is due in ${days} days`;
  const type = String(reminder.reminderType || "vehicle").toUpperCase();
  const vehicle = [reminder.make, reminder.model].filter(Boolean).join(" ");

  return JSON.stringify({
    title: `${type} reminder · ${reminder.registration}`,
    body: `${vehicle || "Your vehicle"} ${type} ${dueText}.`,
    tag: `checkareg-${reminder.reminderType}-${reminder.vehicleId}-${reminder.dueDate}`,
    url: `/account.html?vehicle=${encodeURIComponent(reminder.registration)}`,
  });
}

async function recordReminderAttempt(reminder, success, permanentFailure = false, errorMessage = null) {
  await callSupabaseRpc(authConfig.supabaseAnonKey, "record_push_reminder", {
    p_cron_secret: pushConfig.cronSecret,
    p_subscription_id: reminder.subscriptionId,
    p_vehicle_id: reminder.vehicleId,
    p_reminder_type: reminder.reminderType,
    p_due_date: reminder.dueDate,
    p_success: success,
    p_disable_subscription: permanentFailure,
    p_error: errorMessage ? String(errorMessage).slice(0, 500) : null,
  });
}

async function dispatchDueReminders() {
  const response =
    (await callSupabaseRpc(authConfig.supabaseAnonKey, "get_due_push_reminders", {
      p_cron_secret: pushConfig.cronSecret,
    })) || [];
  const items = Array.isArray(response.reminders) ? response.reminders : [];
  let sent = 0;
  let failed = 0;

  for (const reminder of items) {
    try {
      await webpush.sendNotification(
        {
          endpoint: reminder.endpoint,
          keys: { p256dh: reminder.p256dh, auth: reminder.authKey },
        },
        reminderPayload(reminder),
        { TTL: 60 * 60 * 24 }
      );
      await recordReminderAttempt(reminder, true);
      sent += 1;
    } catch (error) {
      const permanentFailure = error?.statusCode === 404 || error?.statusCode === 410;
      try {
        await recordReminderAttempt(reminder, false, permanentFailure, error?.message);
      } catch (recordError) {
        console.error(`Could not record reminder failure: ${recordError.message}`);
      }
      failed += 1;
      console.error(`Push reminder failed (${error?.statusCode || "unknown"}).`);
    }
  }

  return { checked: items.length, sent, failed };
}

async function sendAdminPushNotification(token, email, title, message) {
  const prepared = await callSupabaseRpc(token, "admin_prepare_push_notification", {
    p_target_email: email,
    p_title: title,
    p_message: message,
  });
  const subscriptions = Array.isArray(prepared.subscriptions) ? prepared.subscriptions : [];
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
        },
        JSON.stringify({
          title: prepared.title,
          body: prepared.message,
          tag: `checkareg-admin-${prepared.notificationId}`,
          url: "/account.html",
        }),
        { TTL: 60 * 60 * 24 }
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Admin push notification failed (${error?.statusCode || "unknown"}).`);
    }
  }

  await callSupabaseRpc(token, "admin_complete_push_notification", {
    p_notification_id: prepared.notificationId,
    p_sent: sent,
    p_failed: failed,
  });

  return {
    email: prepared.email,
    devices: Number(prepared.deviceCount) || 0,
    sent,
    failed,
  };
}

async function sendAdminBroadcastNotification(token, title, message) {
  const prepared = await callSupabaseRpc(token, "admin_prepare_broadcast_push_notification", {
    p_title: title,
    p_message: message,
  });
  const subscriptions = Array.isArray(prepared.subscriptions) ? prepared.subscriptions : [];
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
        },
        JSON.stringify({
          title: prepared.title,
          body: prepared.message,
          tag: `checkareg-broadcast-${prepared.notificationId}`,
          url: "/account.html",
        }),
        { TTL: 60 * 60 * 24 }
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Admin broadcast push failed (${error?.statusCode || "unknown"}).`);
    }
  }

  await callSupabaseRpc(token, "admin_complete_push_notification", {
    p_notification_id: prepared.notificationId,
    p_sent: sent,
    p_failed: failed,
  });

  return {
    accounts: Number(prepared.accountCount) || 0,
    recipients: Number(prepared.recipientAccountCount) || 0,
    devices: Number(prepared.deviceCount) || 0,
    sent,
    failed,
  };
}

async function safelyCancelReservation(token, reservationId) {
  if (!reservationId) return;

  try {
    await callSupabaseRpc(token, "cancel_vehicle_search", {
      p_reservation_id: reservationId,
    });
  } catch (error) {
    console.error(`Could not refund vehicle-search reservation: ${error.message}`);
  }
}

async function fetchDvlaVehicle(registration) {
  let response;

  try {
    response = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "x-api-key": config.dvlaApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ registrationNumber: registration }),
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (cause) {
    const error = new Error("The DVLA service could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const data = await readJsonResponse(response, "DVLA");

  if (!response.ok) {
    const notFound = response.status === 400 || response.status === 404;
    const error = new Error(
      notFound
        ? "Vehicle not found. Check the registration and try again."
        : "The DVLA service is temporarily unavailable."
    );
    error.statusCode = notFound ? 404 : 502;
    error.logMessage = `DVLA request failed with status ${response.status}.`;
    throw error;
  }

  return data;
}

async function getMotToken() {
  const now = Date.now();

  if (cachedMotToken && now < motTokenExpiry) {
    return cachedMotToken;
  }

  let response;

  try {
    response = await fetch(config.motTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.motClientId,
        client_secret: config.motClientSecret,
        scope: config.motScope,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    const error = new Error("The MOT service could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const data = await readJsonResponse(response, "MOT authentication");

  if (!response.ok || !data.access_token) {
    const error = new Error("The MOT service is temporarily unavailable.");
    error.statusCode = 502;
    error.logMessage = `MOT authentication failed with status ${response.status}.`;
    throw error;
  }

  cachedMotToken = data.access_token;
  const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
  motTokenExpiry = now + Math.max(expiresInMs - 30_000, 30_000);

  return cachedMotToken;
}

async function fetchMotHistory(registration) {
  const token = await getMotToken();
  let response;

  try {
    response = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": config.motApiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (cause) {
    const error = new Error("The MOT service could not be reached.", { cause });
    error.statusCode = 502;
    throw error;
  }

  const data = await readJsonResponse(response, "MOT history");

  if (response.status === 404) {
    return {};
  }

  if (!response.ok) {
    const error = new Error("The MOT service is temporarily unavailable.");
    error.statusCode = 502;
    error.logMessage = `MOT history request failed with status ${response.status}.`;
    throw error;
  }

  return data;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!authConfig.supabaseUrl || !authConfig.supabaseAnonKey) {
    return res.status(503).json({
      error: "Account services have not been configured yet.",
    });
  }

  // Only browser-safe Supabase configuration belongs in this response.
  // The secret key bypasses RLS and must remain server-only.
  return res.json({
    supabaseUrl: authConfig.supabaseUrl,
    supabaseAnonKey: authConfig.supabaseAnonKey,
  });
});

app.get("/api/account-export/:secret.csv", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!emailExportSecret || !secretsMatch(req.params.secret, emailExportSecret)) {
    return res.status(404).send("Not found");
  }
  try {
    const data = await callSupabaseRpc(authConfig.supabaseAnonKey, "export_account_emails", {
      p_export_secret: emailExportSecret,
    });
    const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
    const rows = [
      ["Email", "Signed up (UTC)", "Email confirmed"],
      ...accounts.map((account) => [account.email, account.createdAt, account.confirmed ? "TRUE" : "FALSE"]),
    ];
    res.type("text/csv").send(rows.map((row) => row.map(csvCell).join(",")).join("\n"));
  } catch (error) {
    console.error(`Account export failed: ${error.message}`);
    return res.status(502).send("Export unavailable");
  }
});

app.get("/api/allowance", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const { token } = await authenticateRequest(req);
    const allowance = await callSupabaseRpc(token, "get_search_allowance");
    return res.json(allowance);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Your allowance could not be loaded." : error.message,
    });
  }
});

app.get("/api/credits/store", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    enabled: stripeIsConfigured(),
    currency: "GBP",
    creditCost: 2,
    aiQuestionPack,
    plusPlan,
    bundles: creditBundles.map(({ id, credits, amountPence, label }) => ({
      id,
      credits,
      amountPence,
      label,
      searches: credits / 2,
    })),
  });
});

app.get("/api/credits/purchases", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "get_credit_purchase_history", { p_limit: 20 }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Your purchase history could not be loaded." : error.message,
    });
  }
});

app.post("/api/credits/checkout", checkoutLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bundle = creditBundlesById.get(String(req.body?.bundleId || ""));
  if (!bundle) return res.status(400).json({ error: "Choose a valid credit pack." });
  if (!stripeIsConfigured()) {
    return res.status(503).json({ error: "Credit purchases are not available yet." });
  }

  try {
    const { user } = await authenticateRequest(req);
    const appUrl = publicAppUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      success_url: `${appUrl}/credits.html?purchase=success`,
      cancel_url: `${appUrl}/credits.html?purchase=cancelled`,
      metadata: {
        user_id: user.id,
        bundle_id: bundle.id,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: bundle.amountPence,
            product_data: {
              name: `${bundle.credits} CHECK A REG credits`,
              description: `${bundle.credits / 2} additional vehicle checks`,
            },
          },
        },
      ],
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return res.json({ url: session.url });
  } catch (error) {
    const statusCode = error.statusCode || 502;
    if (statusCode >= 500) console.error(`Stripe checkout failed: ${error.message}`);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "The secure checkout could not be opened." : error.message,
    });
  }
});

app.get("/api/plus/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "get_biismo_entitlements"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: statusCode >= 500 ? "Your plan could not be loaded." : error.message });
  }
});

app.post("/api/ai/questions/purchase", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "purchase_ai_question_pack"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: statusCode >= 500 ? "AI Mechanic questions could not be unlocked." : error.message });
  }
});

app.post("/api/plus/checkout", checkoutLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!stripeIsConfigured()) return res.status(503).json({ error: "CHECK A REG+ checkout is not available yet." });
  try {
    const { token, user } = await authenticateRequest(req);
    const current = await callSupabaseRpc(token, "get_my_biismo_plus_customer");
    if (current?.plusActive) return res.status(409).json({ error: "CHECK A REG+ is already active on this account." });
    const appUrl = publicAppUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: user.id,
      ...(current?.customerId ? { customer: current.customerId } : { customer_email: user.email || undefined }),
      success_url: `${appUrl}/credits.html?plus=success`,
      cancel_url: `${appUrl}/credits.html?plus=cancelled`,
      metadata: { user_id: user.id, plan_id: plusPlan.id },
      subscription_data: { metadata: { user_id: user.id, plan_id: plusPlan.id } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: plusPlan.currency,
          unit_amount: plusPlan.amountPence,
          recurring: { interval: plusPlan.interval },
          product_data: {
            name: plusPlan.label,
            description: `${plusPlan.creditsMonthly} credits, ${plusPlan.aiQuestionsMonthly} AI questions and a ${plusPlan.garageLimit}-vehicle Garage each month`,
          },
        },
      }],
    });
    if (!session.url) throw new Error("Stripe did not return a subscription checkout URL.");
    return res.json({ url: session.url });
  } catch (error) {
    const statusCode = error.statusCode || 502;
    if (statusCode >= 500) console.error(`CHECK A REG+ checkout failed: ${error.message}`);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "CHECK A REG+ checkout could not be opened." : error.message });
  }
});

app.post("/api/plus/portal", checkoutLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!stripeIsConfigured()) return res.status(503).json({ error: "Subscription management is not available yet." });
  try {
    const { token } = await authenticateRequest(req);
    const current = await callSupabaseRpc(token, "get_my_biismo_plus_customer");
    if (!current?.customerId) return res.status(404).json({ error: "No Stripe subscription profile is linked to this account yet." });
    const session = await stripe.billingPortal.sessions.create({
      customer: current.customerId,
      return_url: `${publicAppUrl(req)}/credits.html`,
    });
    return res.json({ url: session.url });
  } catch (error) {
    const statusCode = error.statusCode || 502;
    return res.status(statusCode).json({ error: statusCode >= 500 ? "Subscription management could not be opened." : error.message });
  }
});

app.get("/api/push/public-key", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!pushConfig.publicKey) {
    return res.status(503).json({ error: "Vehicle reminders are not configured yet." });
  }
  return res.json({ publicKey: pushConfig.publicKey });
});

app.post("/api/push/subscribe", pushActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const subscription = req.body?.subscription;
  if (!validPushSubscription(subscription)) {
    return res.status(400).json({ error: "That notification subscription is invalid." });
  }

  try {
    const { token } = await authenticateRequest(req);
    const result = await callSupabaseRpc(token, "upsert_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
      p_user_agent: String(req.get("user-agent") || "").slice(0, 500),
    });
    return res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Reminders could not be enabled." : error.message,
    });
  }
});

app.delete("/api/push/subscribe", pushActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const endpoint = String(req.body?.endpoint || "");
  if (!endpoint.startsWith("https://") || endpoint.length > 2048) {
    return res.status(400).json({ error: "That notification subscription is invalid." });
  }

  try {
    const { token } = await authenticateRequest(req);
    const result = await callSupabaseRpc(token, "delete_push_subscription", {
      p_endpoint: endpoint,
    });
    return res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Reminders could not be disabled." : error.message,
    });
  }
});

app.get("/api/reminders/preferences", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "get_vehicle_reminder_preferences"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Vehicle reminder choices could not be loaded." : error.message,
    });
  }
});

app.post("/api/reminders/preferences", pushActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const vehicleId = String(req.body?.vehicleId || "");
  const enabled = req.body?.enabled;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vehicleId)) {
    return res.status(400).json({ error: "Choose a valid saved vehicle." });
  }
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Choose whether reminders are enabled." });
  }

  try {
    const { token } = await authenticateRequest(req);
    return res.json(
      await callSupabaseRpc(token, "set_vehicle_reminder_preference", {
        p_vehicle_id: vehicleId,
        p_enabled: enabled,
      })
    );
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "That reminder choice could not be saved." : error.message,
    });
  }
});

app.post("/api/cron/reminders", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!pushIsConfigured()) {
    return res.status(503).json({ error: "Vehicle reminders are not configured yet." });
  }
  if (!secretsMatch(req.get("x-cron-secret"), pushConfig.cronSecret)) {
    return res.status(401).json({ error: "Invalid reminder job credentials." });
  }

  try {
    return res.json(await dispatchDueReminders());
  } catch (error) {
    console.error(`Reminder dispatch failed: ${error.message}`);
    return res.status(502).json({ error: "Vehicle reminders could not be dispatched." });
  }
});

app.post("/api/grant-credits", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const email = String(req.body?.email || "").trim().toLowerCase();
  const amount = Number(req.body?.amount);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Enter a complete account email address." });
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    return res.status(400).json({ error: "Enter a credit amount between 1 and 100,000." });
  }

  try {
    const { token } = await authenticateRequest(req);
    const grant = await callSupabaseRpc(token, "admin_grant_credits", {
      p_target_email: email,
      p_amount: amount,
    });
    return res.json(grant);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "Credits could not be granted." : error.message,
    });
  }
});

app.post("/api/admin/user-credits", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Enter a complete account email address." });
  }

  try {
    const { token } = await authenticateRequest(req);
    const account = await callSupabaseRpc(token, "admin_get_user_credits", {
      p_target_email: email,
    });
    return res.json(account);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "That user could not be loaded." : error.message,
    });
  }
});

app.post("/api/admin/set-credits", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const email = String(req.body?.email || "").trim().toLowerCase();
  const amount = Number(req.body?.amount);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Enter a complete account email address." });
  }
  if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
    return res.status(400).json({ error: "Enter a credit balance between 0 and 100,000." });
  }

  try {
    const { token } = await authenticateRequest(req);
    const account = await callSupabaseRpc(token, "admin_set_user_credits", {
      p_target_email: email,
      p_amount: amount,
    });
    return res.json(account);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "That credit balance could not be changed." : error.message,
    });
  }
});

app.post("/api/admin/send-notification", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const email = String(req.body?.email || "").trim().toLowerCase();
  const title = String(req.body?.title || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "Enter a complete account email address." });
  }
  if (title.length < 1 || title.length > 80) {
    return res.status(400).json({ error: "Enter a notification title between 1 and 80 characters." });
  }
  if (message.length < 1 || message.length > 240) {
    return res.status(400).json({ error: "Enter a notification message between 1 and 240 characters." });
  }
  if (!pushKeysAreConfigured()) {
    return res.status(503).json({ error: "Push notifications are not configured yet." });
  }

  try {
    const { token } = await authenticateRequest(req);
    return res.json(await sendAdminPushNotification(token, email, title, message));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "The push notification could not be sent." : error.message,
    });
  }
});

app.get("/api/admin/push-audience", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "admin_get_push_audience"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "The push audience could not be loaded." : error.message,
    });
  }
});

app.get("/api/notifications", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "get_user_notifications", { p_limit: 50 }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "Notifications could not be loaded." : error.message });
  }
});

app.post("/api/notifications/read-all", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "mark_all_user_notifications_read"));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "Notifications could not be updated." : error.message });
  }
});

app.post("/api/notifications/:id/read", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "That notification is invalid." });
  }
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "set_user_notification_read", {
      p_notification_id: req.params.id,
      p_read: req.body?.read !== false,
    }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "That notification could not be updated." : error.message });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "That notification is invalid." });
  }
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "delete_user_notification", { p_notification_id: req.params.id }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "That notification could not be deleted." : error.message });
  }
});

app.get("/api/admin/broadcast-history", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await callSupabaseRpc(token, "admin_get_broadcast_history", { p_limit: 25 }));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({ error: statusCode >= 500 ? "Broadcast history could not be loaded." : error.message });
  }
});

app.post("/api/admin/send-broadcast", adminActionLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const title = String(req.body?.title || "").trim();
  const message = String(req.body?.message || "").trim();

  if (title.length < 1 || title.length > 80) {
    return res.status(400).json({ error: "Enter a notification title between 1 and 80 characters." });
  }
  if (message.length < 1 || message.length > 240) {
    return res.status(400).json({ error: "Enter a notification message between 1 and 240 characters." });
  }
  try {
    const { token } = await authenticateRequest(req);
    return res.json(await sendAdminBroadcastNotification(token, title, message));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error.message);
    return res.status(statusCode).json({
      error: statusCode >= 500 ? "The broadcast push notification could not be sent." : error.message,
    });
  }
});

app.post("/api/check", vehicleCheckLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  let token = null;
  let reservationId = null;

  try {
    const registration = normalizeRegistration(req.body?.registrationNumber);
    ({ token } = await authenticateRequest(req));
    assertConfigured();

    const reservation = await callSupabaseRpc(token, "reserve_vehicle_search", {
      p_registration: registration,
    });

    if (!reservation?.allowed) {
      return res.status(402).json({
        error: reservation?.message || "You have no searches available.",
        allowance: reservation,
      });
    }

    reservationId = reservation.reservationId;
    const dvla = await fetchDvlaVehicle(registration);
    const mot = await fetchMotHistory(registration);

    let allowance;
    try {
      allowance = await callSupabaseRpc(token, "complete_vehicle_search", {
        p_reservation_id: reservationId,
      });
      reservationId = null;
    } catch (cause) {
      await safelyCancelReservation(token, reservationId);
      reservationId = null;
      const error = new Error("The search could not be recorded. Please try again.", { cause });
      error.statusCode = 502;
      throw error;
    }

    res.json({
      ...buildVehicleResponse(registration, dvla, mot),
      allowance,
    });
  } catch (error) {
    await safelyCancelReservation(token, reservationId);
    const statusCode =
      error instanceof ValidationError ? 400 : error.statusCode || 500;

    if (statusCode >= 500) {
      console.error(error.logMessage || error.message);
    }
    res.status(statusCode).json({
      error:
        statusCode >= 500 && statusCode !== 503
          ? error.message || "Vehicle check failed."
          : error.message,
    });
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
    return res.status(404).json({ error: "Endpoint not found." });
  }

  return res.status(404).sendFile("index.html", { root: "public" });
});

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`CHECK A REG listening on port ${PORT}.`);
  });
}

export { app };
