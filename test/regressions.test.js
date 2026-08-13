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
  assert.match(worker, /"\/mobile-accessibility\.css"/);
});

test("every interactive app page loads the shared mobile accessibility layer", async () => {
  const pages = ["index.html", "account.html", "credits.html", "ai-mechanic.html", "notifications.html"];
  for (const page of pages) {
    const html = await read(`public/${page}`);
    assert.match(html, /<link rel="stylesheet" href="mobile-accessibility\.css">/, `${page} is missing mobile controls CSS`);
  }

  const [css, aiEntry] = await Promise.all([
    read("public/mobile-accessibility.css"),
    read("public/ai-entry.js"),
  ]);
  assert.match(css, /min-height: 44px !important/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /\.home-header-actions \.ai-mechanic-entry/);
  assert.match(css, /grid-template-columns: 48px minmax\(78px, auto\)/);
  assert.match(css, /grid-template-columns: 44px 44px minmax\(72px, 1fr\)/);
  assert.match(css, /\.notification-bell[\s\S]*min-height: 44px !important/);
  assert.match(aiEntry, /aria-label", "Open Check A Reg AI Mechanic"/);
});

test("homepage mobile controls and footer remain centred and accessible", async () => {
  const [home, css] = await Promise.all([
    read("public/index.html"),
    read("public/mobile-accessibility.css"),
  ]);

  assert.match(home, /© 2026 Check A Reg\. All rights reserved\./);
  assert.match(css, /body\.home-page \.trust-row[\s\S]*place-items: center !important/);
  assert.match(css, /body\.home-page \.search-panel > \.primary-button[\s\S]*height: 52px !important/);
  assert.match(css, /min-height: calc\(88px \+ env\(safe-area-inset-top, 0px\)\)/);
});

test("account page uses real unique elements instead of a global getElementById patch", async () => {
  const [html, splash, admin] = await Promise.all([
    read("public/account.html"),
    read("public/splash.js"),
    read("public/admin-controls.js"),
  ]);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "account.html contains duplicate IDs");
  assert.doesNotMatch(splash, /Document\.prototype\.getElementById\s*=/);
  for (const id of ["garageStatus", "adminUserSearchButton", "adminAccountStatusBadge"]) {
    assert.ok(ids.includes(id), `missing #${id}`);
  }
  for (const id of ["adminTotalUsers", "adminActiveUsers", "adminBannedUsers", "adminSearchesToday", "adminCreditsTotal"]) {
    assert.ok(ids.includes(id), `missing dashboard metric #${id}`);
    assert.match(admin, new RegExp(`${id}:`), `admin dashboard does not render #${id}`);
  }
  assert.doesNotMatch(admin, /adminMetric(?:TotalUsers|VerifiedUsers|BannedUsers|SearchesToday|PushSubscribers)/);
});

test("admin dashboard migration defines every staff RPC used by the portal", async () => {
  const [migration, directory, logs] = await Promise.all([
    read("supabase/migrations/20260813030000_repair_admin_dashboard.sql"),
    read("public/staff-user-directory.js"),
    read("public/admin-ai-logs.js"),
  ]);

  assert.match(directory, /rpc\("staff_list_accounts"\)/);
  assert.match(logs, /\.rpc\('admin_get_ai_logs'/);
  assert.match(migration, /function public\.staff_list_accounts\(\)/);
  assert.match(migration, /function public\.admin_get_ai_logs\(p_target_email text, p_limit integer/);
  assert.match(migration, /'creditsInCirculation'/);
});

test("database hardening migration covers advisor findings from the sweep", async () => {
  const sql = await read("supabase/migrations/20260813030500_harden_database_indexes.sql");
  for (const index of [
    "ai_question_reservations_case_id_idx",
    "app_moderators_added_by_idx",
    "staff_support_notes_staff_user_id_idx",
    "ai_mechanic_cases_vehicle_id_idx",
    "ai_mechanic_messages_user_id_idx",
  ]) {
    assert.match(sql, new RegExp(index));
  }
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
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
  assert.match(portalCss, /\.owner-portal-page \.garage-search \{[\s\S]*?display: block;/);
  assert.match(portalCss, /\.owner-portal-page \.garage-search-row \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
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
