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
