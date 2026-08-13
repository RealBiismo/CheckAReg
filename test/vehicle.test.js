import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVehicleResponse,
  normalizeMotHistory,
  normalizeRegistration,
  ValidationError,
} from "../lib/vehicle.js";
import { app } from "../server.js";

test("normalizes a registration", () => {
  assert.equal(normalizeRegistration("pa55 mgn"), "PA55MGN");
  assert.equal(normalizeRegistration("ab-12-cde"), "AB12CDE");
});

test("rejects malformed registration input", () => {
  assert.throws(() => normalizeRegistration("<script>"), ValidationError);
  assert.throws(() => normalizeRegistration("ABCDEFG"), ValidationError);
  assert.throws(() => normalizeRegistration("1234567"), ValidationError);
});

test("normalizes and deduplicates MOT defects", () => {
  const history = normalizeMotHistory({
    motTests: [
      {
        completedDate: "2025-01-02",
        testResult: "PASSED",
        odometerValue: "45000",
        rfrAndComments: [{ text: "Tyre worn", type: "ADVISORY" }],
        advisories: [{ text: "Tyre worn" }],
        majorDefects: [{ description: "Brake defective" }],
      },
    ],
  });

  assert.equal(history.length, 1);
  assert.deepEqual(history[0].defects, [
    { text: "Tyre worn", type: "ADVISORY" },
    { text: "Brake defective", type: "MAJOR" },
  ]);
});

test("builds a stable response when no MOT history exists", () => {
  const response = buildVehicleResponse(
    "PA55MGN",
    { make: "BMW", taxStatus: "Taxed", engineCapacity: 1995 },
    {}
  );

  assert.equal(response.registration, "PA55MGN");
  assert.equal(response.make, "BMW");
  assert.equal(response.engineCapacity, 1995);
  assert.deepEqual(response.motHistory, []);
});

test("serves health status and rejects unsafe input", async (context) => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });

  const invalidResponse = await fetch(`${baseUrl}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: "<script>" }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "Enter a valid UK registration number.",
  });

  const signedOutCheckResponse = await fetch(`${baseUrl}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registrationNumber: "PA55MGN" }),
  });
  assert.equal(signedOutCheckResponse.status, 401);
  assert.deepEqual(await signedOutCheckResponse.json(), {
    error: "Sign in to check a vehicle.",
  });

  const invalidGrantResponse = await fetch(`${baseUrl}/api/grant-credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", amount: 2 }),
  });
  assert.equal(invalidGrantResponse.status, 400);
  assert.deepEqual(await invalidGrantResponse.json(), {
    error: "Enter a complete account email address.",
  });

  const invalidAdminLookupResponse = await fetch(`${baseUrl}/api/admin/user-credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "missing-at-sign" }),
  });
  assert.equal(invalidAdminLookupResponse.status, 400);
  assert.deepEqual(await invalidAdminLookupResponse.json(), {
    error: "Enter a complete account email address.",
  });

  const invalidSetCreditsResponse = await fetch(`${baseUrl}/api/admin/set-credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", amount: -1 }),
  });
  assert.equal(invalidSetCreditsResponse.status, 400);
  assert.deepEqual(await invalidSetCreditsResponse.json(), {
    error: "Enter a credit balance between 0 and 100,000.",
  });

  const invalidPushResponse = await fetch(`${baseUrl}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: { endpoint: "javascript:bad" } }),
  });
  assert.equal(invalidPushResponse.status, 400);
  assert.deepEqual(await invalidPushResponse.json(), {
    error: "That notification subscription is invalid.",
  });

  const invalidPushDeleteResponse = await fetch(`${baseUrl}/api/push/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "http://not-secure.example" }),
  });
  assert.equal(invalidPushDeleteResponse.status, 400);
  assert.deepEqual(await invalidPushDeleteResponse.json(), {
    error: "That notification subscription is invalid.",
  });

  const invalidReminderVehicleResponse = await fetch(`${baseUrl}/api/reminders/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicleId: "not-a-uuid", enabled: true }),
  });
  assert.equal(invalidReminderVehicleResponse.status, 400);
  assert.deepEqual(await invalidReminderVehicleResponse.json(), {
    error: "Choose a valid saved vehicle.",
  });

  const invalidReminderChoiceResponse = await fetch(`${baseUrl}/api/reminders/preferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vehicleId: "00000000-0000-4000-8000-000000000001", enabled: "yes" }),
  });
  assert.equal(invalidReminderChoiceResponse.status, 400);
  assert.deepEqual(await invalidReminderChoiceResponse.json(), {
    error: "Choose whether reminders are enabled.",
  });

  const invalidAdminNotificationResponse = await fetch(`${baseUrl}/api/admin/send-notification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", title: "CHECK A REG", message: "" }),
  });
  assert.equal(invalidAdminNotificationResponse.status, 400);
  assert.deepEqual(await invalidAdminNotificationResponse.json(), {
    error: "Enter a notification message between 1 and 240 characters.",
  });

  const invalidBroadcastResponse = await fetch(`${baseUrl}/api/admin/send-broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "CHECK A REG", message: "" }),
  });
  assert.equal(invalidBroadcastResponse.status, 400);
  assert.deepEqual(await invalidBroadcastResponse.json(), {
    error: "Enter a notification message between 1 and 240 characters.",
  });

  const signedOutAudienceResponse = await fetch(`${baseUrl}/api/admin/push-audience`);
  assert.equal(signedOutAudienceResponse.status, 401);

  const pushKeyResponse = await fetch(`${baseUrl}/api/push/public-key`);
  assert.equal(pushKeyResponse.status, 503);
  assert.deepEqual(await pushKeyResponse.json(), {
    error: "Vehicle reminders are not configured yet.",
  });

  const cronResponse = await fetch(`${baseUrl}/api/cron/reminders`, { method: "POST" });
  assert.equal(cronResponse.status, 503);
  assert.deepEqual(await cronResponse.json(), {
    error: "Vehicle reminders are not configured yet.",
  });

  const unconfiguredAdminNotificationResponse = await fetch(`${baseUrl}/api/admin/send-notification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", title: "CHECK A REG", message: "Test message" }),
  });
  assert.equal(unconfiguredAdminNotificationResponse.status, 503);
  assert.deepEqual(await unconfiguredAdminNotificationResponse.json(), {
    error: "Push notifications are not configured yet.",
  });

  const unconfiguredBroadcastResponse = await fetch(`${baseUrl}/api/admin/send-broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "CHECK A REG", message: "Test broadcast" }),
  });
  assert.equal(unconfiguredBroadcastResponse.status, 401);
  assert.deepEqual(await unconfiguredBroadcastResponse.json(), {
    error: "Sign in to check a vehicle.",
  });

  const signedOutNotificationsResponse = await fetch(`${baseUrl}/api/notifications`);
  assert.equal(signedOutNotificationsResponse.status, 401);

  const creditStoreResponse = await fetch(`${baseUrl}/api/credits/store`);
  assert.equal(creditStoreResponse.status, 200);
  const creditStore = await creditStoreResponse.json();
  assert.equal(creditStore.enabled, false);
  assert.deepEqual(
    creditStore.bundles.map(({ id, credits, amountPence, searches }) => ({ id, credits, amountPence, searches })),
    [
      { id: "starter", credits: 10, amountPence: 149, searches: 5 },
      { id: "popular", credits: 30, amountPence: 379, searches: 15 },
      { id: "best_value", credits: 80, amountPence: 849, searches: 40 },
    ]
  );

  const invalidCheckoutResponse = await fetch(`${baseUrl}/api/credits/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bundleId: "made-up-pack" }),
  });
  assert.equal(invalidCheckoutResponse.status, 400);
  assert.deepEqual(await invalidCheckoutResponse.json(), { error: "Choose a valid credit pack." });

  const signedOutPurchasesResponse = await fetch(`${baseUrl}/api/credits/purchases`);
  assert.equal(signedOutPurchasesResponse.status, 401);

  const unconfiguredWebhookResponse = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unconfiguredWebhookResponse.status, 503);
  assert.deepEqual(await unconfiguredWebhookResponse.json(), {
    error: "Credit purchases are not configured yet.",
  });

  const invalidNotificationResponse = await fetch(`${baseUrl}/api/notifications/not-a-uuid`, { method: "DELETE" });
  assert.equal(invalidNotificationResponse.status, 400);

  const privateExportResponse = await fetch(`${baseUrl}/api/account-export/not-the-secret.csv`);
  assert.equal(privateExportResponse.status, 404);

  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 503);
  assert.deepEqual(await configResponse.json(), {
    error: "Account services have not been configured yet.",
  });
});
