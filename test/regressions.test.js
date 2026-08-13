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
  assert.match(worker, /"\/simple-app\.css"/);
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

test("signed-in screens use one simplified visual system without duplicate account navigation", async () => {
  const pages = ["account.html", "credits.html", "ai-mechanic.html", "notifications.html"];
  for (const page of pages) {
    const html = await read(`public/${page}`);
    assert.match(html, /<link rel="stylesheet" href="simple-app\.css">/, `${page} is missing simplified UI CSS`);
  }

  const [account, ai, css] = await Promise.all([
    read("public/account.html"),
    read("public/ai-mechanic.html"),
    read("public/simple-app.css"),
  ]);
  assert.doesNotMatch(account, /account-hub-tabs|data-hub-screen/);
  assert.match(account, /id="requestDeletionButton"[^>]*>Delete account<\/button>/);
  assert.match(account, /security-compact-grid/);
  assert.doesNotMatch(ai, /ai-price-card|ai-access-row/);
  assert.match(css, /Garage: one hero, one status strip/);
  assert.match(css, /\.service-card\.plus-card[^{]*\{[^}]*box-shadow:none!important/);
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

test("selected plate mark is used for favicon, PWA and account access branding", async () => {
  const pages = ["index.html", "account.html", "credits.html", "ai-mechanic.html", "notifications.html"];
  for (const page of pages) {
    const html = await read(`public/${page}`);
    assert.match(html, /href="\/favicon-32\.png"/);
    assert.match(html, /href="\/favicon\.ico"/);
  }

  const [auth, worker, manifest] = await Promise.all([
    read("public/auth.js"),
    read("public/sw.js"),
    read("public/manifest.json"),
  ]);
  assert.match(auth, /<img src="\/icon\.svg" alt="Check A Reg">/);
  assert.match(worker, /check-a-reg-v10/);
  assert.match(worker, /"\/favicon-32\.png"/);
  assert.match(worker, /"\/favicon\.ico"/);
  assert.match(manifest, /"src": "\/icon-192\.png"/);
  assert.match(manifest, /"src": "\/icon-512\.png"/);

  const icon = await read("public/icon.svg");
  assert.match(icon, /viewBox="0 0 256 256"/);
  assert.match(icon, /clip-path="url\(#plate-shape\)"/);
  assert.doesNotMatch(icon, /<rect[^>]+width="256"[^>]+fill=/);
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

test("My Account hub includes secure profiles, privacy export and threaded support", async () => {
  const [html, script, css, migration, conversationMigration, worker, staff] = await Promise.all([
    read("public/account.html"),
    read("public/account-hub.js"),
    read("public/account-hub.css"),
    read("supabase/migrations/20260813040000_add_account_support_hub.sql"),
    read("supabase/migrations/20260813190000_add_support_ticket_conversations.sql"),
    read("public/sw.js"),
    read("public/staff-dashboard-organizer.js"),
  ]);

  for (const id of [
    "profileView", "profileDisplayName", "profileAvatarInput", "changeEmailForm",
    "changePasswordForm", "supportTicketForm", "mySupportTickets", "adminSupportInbox",
    "accountOverviewScreen", "accountSettingsScreen", "accountSupportScreen",
    "userSupportMessages", "userSupportReplyForm", "adminSupportMessages",
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.match(script, /from\("user_profiles"\)/);
  assert.match(script, /from\("support_tickets"\)/);
  assert.match(script, /staff_list_support_tickets/);
  assert.match(script, /staff_update_support_ticket/);
  assert.match(script, /staff_get_support_thread/);
  assert.match(script, /from\("support_ticket_messages"\)/);
  assert.doesNotMatch(script, /event\.currentTarget\.reset\(\)/);
  assert.match(script, /const form = event\.currentTarget/);
  assert.match(script, /createSignedUrl/);
  assert.match(script, /auth\.updateUser\(\{ email \}\)/);
  assert.match(script, /auth\.updateUser\(\{ password \}\)/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /\.support-inbox-shell\.is-viewing-thread/);
  assert.match(staff, /\["support", "Support"\]/);
  assert.match(worker, /"\/account-hub\.js"/);
  assert.match(worker, /"\/account-hub\.css"/);

  const server = await read("server.js");
  assert.match(server, /img-src 'self' data: blob: https:\/\/\*\.supabase\.co/);

  assert.match(migration, /alter table public\.user_profiles enable row level security/);
  assert.match(migration, /alter table public\.support_tickets enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /storage\.foldername\(name\)/);
  assert.match(migration, /revoke all on public\.support_tickets from public, anon, authenticated/);
  assert.match(conversationMigration, /create table if not exists public\.support_ticket_messages/);
  assert.match(conversationMigration, /alter table public\.support_ticket_messages enable row level security/);
  assert.match(conversationMigration, /ticket\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(conversationMigration, /function public\.staff_get_support_thread\(p_ticket_id uuid\)/);
  assert.match(conversationMigration, /support_ticket_seeds_conversation/);
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
