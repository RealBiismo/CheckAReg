import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI requests have a hard timeout and runtime CSS is CSP-safe", async () => {
  const [mechanic, mobile, css] = await Promise.all([
    read("public/ai-mechanic.js"),
    read("public/ai-mobile-v2.js"),
    read("public/ai-mobile-v2.css"),
  ]);

  assert.match(mechanic, /AI_REQUEST_TIMEOUT_MS\s*=\s*45_000/);
  assert.match(mechanic, /Promise\.race/);
  assert.doesNotMatch(`${mechanic}\n${mobile}`, /createElement\(['"]style['"]\)/);
  assert.match(css, /\.ai-mobile-draft-vehicle\{display:none\}/);
});

test("service worker updates app shells from network without atomic precache failure", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /"\/script\.js"/);
  assert.match(worker, /"\/style\.css"/);
  assert.match(worker, /Promise\.allSettled/);
  assert.doesNotMatch(worker, /cache\.addAll/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
});

test("account page uses real unique elements instead of a global getElementById patch", async () => {
  const [html, splash] = await Promise.all([read("public/account.html"), read("public/splash.js")]);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "account.html contains duplicate IDs");
  assert.doesNotMatch(splash, /Document\.prototype\.getElementById\s*=/);
  for (const id of ["garageStatus", "adminUserSearchButton", "adminAccountStatusBadge"]) {
    assert.ok(ids.includes(id), `missing #${id}`);
  }
});

test("AI reconciliation migration includes entitlements, standalone chat and soft delete", async () => {
  const sql = await read("supabase/migrations/202608121900_reconcile_biismo_ai.sql");
  assert.match(sql, /purchase_ai_question_pack/);
  assert.match(sql, /reserve_ai_mechanic_question/);
  assert.match(sql, /alter column vehicle_id drop not null/);
  assert.match(sql, /delete_my_ai_mechanic_case/);
  assert.match(sql, /user_deleted_at/);
});

test("public config never exposes the Supabase server secret", async () => {
  const server = await read("server.js");
  const configRoute = server.slice(server.indexOf('app.get("/api/config"'), server.indexOf('app.get("/api/account-export'));
  assert.match(configRoute, /supabaseAnonKey/);
  assert.doesNotMatch(configRoute, /res\.json\(authConfig\)/);
  assert.doesNotMatch(configRoute, /supabaseSecretKey\s*:/);
});

test("vehicle results hide homepage-only navigation and sections", async () => {
  const [css, preview] = await Promise.all([
    read("public/full-history-preview.css"),
    read("public/full-history-preview.js"),
  ]);

  assert.match(css, /\.vehicle-result-mode \.demo-nav/);
  assert.match(css, /\.vehicle-result-mode \.demo-features/);
  assert.match(css, /\.vehicle-result-mode \.demo-how/);
  assert.match(preview, /classList\.add\("vehicle-result-mode"\)/);
  assert.match(preview, /classList\.remove\("vehicle-result-mode"\)/);
});

test("owner portal redesign stays isolated from the homepage", async () => {
  const [home, account, credits, portalCss, splash, pwa, worker] = await Promise.all([
    read("public/index.html"),
    read("public/account.html"),
    read("public/credits.html"),
    read("public/owner-portal.css"),
    read("public/splash.js"),
    read("public/pwa.js"),
    read("public/sw.js"),
  ]);

  assert.doesNotMatch(home, /owner-portal\.css/);
  assert.match(account, /owner-portal\.css/);
  assert.match(credits, /owner-portal\.css/);
  assert.match(portalCss, /body\.owner-portal-page/);
  assert.doesNotMatch(splash, /referral\.js/);
  assert.doesNotMatch(pwa, /void initializeReferralFeature\(\)/);
  assert.match(worker, /"\/owner-portal\.css"/);
});

test("credit pricing is consistent across checkout, UI and fulfilment migration", async () => {
  const [server, creditsPage, migration] = await Promise.all([
    read("server.js"),
    read("public/credits.html"),
    read("supabase/migrations/20260813011034_refresh_credit_pricing.sql"),
  ]);

  assert.match(server, /id: "starter", credits: 10, amountPence: 149/);
  assert.match(server, /id: "popular", credits: 30, amountPence: 379/);
  assert.match(server, /id: "best_value", credits: 80, amountPence: 849/);
  assert.match(server, /amountPence: 599/);
  assert.match(creditsPage, /<strong>£5\.99<\/strong>/);
  assert.match(migration, /'starter', 'Quick check', 10, 149/);
  assert.match(migration, /'popular', 'Driver', 30, 379/);
  assert.match(migration, /'best_value', 'Garage', 80, 849/);
});
