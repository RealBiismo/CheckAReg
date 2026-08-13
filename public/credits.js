const storeCreditBalance = document.getElementById("storeCreditBalance");
const storeAiQuestions = document.getElementById("storeAiQuestions");
const storePlan = document.getElementById("storePlan");
const creditPackGrid = document.getElementById("creditPackGrid");
const purchaseStatus = document.getElementById("purchaseStatus");
const purchaseHistoryList = document.getElementById("purchaseHistoryList");
const loadingOverlay = document.getElementById("loadingOverlay");
const buyAiQuestionsButton = document.getElementById("buyAiQuestionsButton");
const plusPlanButton = document.getElementById("plusPlanButton");
const plusPlanCard = document.getElementById("plusPlanCard");
const plusPlanNote = document.getElementById("plusPlanNote");

let storeData = null;
let entitlements = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setLoading(visible) {
  loadingOverlay.classList.toggle("is-visible", visible);
  loadingOverlay.setAttribute("aria-hidden", String(!visible));
}

function setPurchaseStatus(message, type = "") {
  purchaseStatus.textContent = message;
  purchaseStatus.className = `purchase-status ${type ? `is-${type}` : ""}`.trim();
}

function formatMoney(amountPence, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(Number(amountPence || 0) / 100);
}

function formatPurchaseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function authedJson(url, options = {}) {
  const response = await window.biismoAuth.authorizedFetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "That request could not be completed.");
  return data;
}

function renderEntitlements(data) {
  entitlements = data;
  storeCreditBalance.textContent = String(Number(data.credits) || 0);
  storeAiQuestions.textContent = String(Number(data.aiQuestions) || 0);
  storePlan.textContent = data.plusActive ? "REG+" : "Free";

  if (data.plusActive) {
    plusPlanCard.classList.add("is-active");
    plusPlanButton.textContent = "Manage Check A Reg+";
    plusPlanButton.dataset.mode = "manage";
    plusPlanNote.textContent = data.subscriptionPeriodEnd
      ? `Active · current billing period ends ${new Date(data.subscriptionPeriodEnd).toLocaleDateString("en-GB")}`
      : "Check A Reg+ is active on this account.";
  } else {
    plusPlanCard.classList.remove("is-active");
    plusPlanButton.textContent = "Start Check A Reg+";
    plusPlanButton.dataset.mode = "subscribe";
    plusPlanNote.textContent = "No contract. Cancel anytime through secure Stripe billing.";
  }
}

async function loadEntitlements() {
  const data = await authedJson("/api/plus/status", { cache: "no-store" });
  renderEntitlements(data);
  return data;
}

async function loadPurchaseHistory() {
  const data = await authedJson("/api/credits/purchases", { cache: "no-store" });
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  purchaseHistoryList.innerHTML = purchases.length
    ? purchases.map((purchase) => `
      <article class="purchase-history-item">
        <div><strong>${Number(purchase.credits) || 0} credits</strong><span>${escapeHtml(formatMoney(purchase.amountPence, purchase.currency))}</span></div>
        <time datetime="${escapeHtml(purchase.createdAt)}">${escapeHtml(formatPurchaseDate(purchase.createdAt))}</time>
      </article>`).join("")
    : "<p>No credit purchases yet.</p>";
}

async function startCreditCheckout(bundleId, button) {
  const buttons = [...creditPackGrid.querySelectorAll("button")];
  buttons.forEach((item) => { item.disabled = true; });
  const original = button.textContent;
  button.textContent = "Opening checkout…";
  setPurchaseStatus("Connecting securely to Stripe…");
  try {
    const data = await authedJson("/api/credits/checkout", { method: "POST", body: JSON.stringify({ bundleId }) });
    window.location.assign(data.url);
  } catch (error) {
    setPurchaseStatus(error.message, "error");
    buttons.forEach((item) => { item.disabled = false; });
    button.textContent = original;
  }
}

async function buyAiQuestions() {
  if (!entitlements) return;
  if ((Number(entitlements.credits) || 0) < 4) {
    setPurchaseStatus("You need 4 credits to unlock 10 AI Mechanic questions.", "error");
    return;
  }
  buyAiQuestionsButton.disabled = true;
  buyAiQuestionsButton.textContent = "Unlocking questions…";
  setPurchaseStatus("Adding 10 AI Mechanic questions to your account…");
  try {
    const data = await authedJson("/api/ai/questions/purchase", { method: "POST", body: "{}" });
    renderEntitlements(data);
    setPurchaseStatus("10 AI Mechanic questions added. They do not expire.", "success");
  } catch (error) {
    setPurchaseStatus(error.message, "error");
  } finally {
    buyAiQuestionsButton.disabled = false;
    buyAiQuestionsButton.textContent = "Unlock 10 questions · 4 credits";
  }
}

async function handlePlus() {
  const managing = plusPlanButton.dataset.mode === "manage";
  plusPlanButton.disabled = true;
  const original = plusPlanButton.textContent;
  plusPlanButton.textContent = managing ? "Opening billing…" : "Opening subscription…";
  setPurchaseStatus(managing ? "Opening secure subscription management…" : "Connecting securely to Stripe…");
  try {
    const data = await authedJson(managing ? "/api/plus/portal" : "/api/plus/checkout", { method: "POST", body: "{}" });
    window.location.assign(data.url);
  } catch (error) {
    setPurchaseStatus(error.message, "error");
    plusPlanButton.disabled = false;
    plusPlanButton.textContent = original;
  }
}

async function loadStore() {
  const response = await fetch("/api/credits/store", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Plans and credits could not be loaded.");
  storeData = data;
  const bundles = Array.isArray(data.bundles) ? data.bundles : [];
  creditPackGrid.innerHTML = bundles.map((bundle) => `
    <article class="credit-pack ${bundle.id === "popular" ? "is-featured" : ""}">
      <span class="credit-pack-label">${escapeHtml(bundle.label)}</span>
      <strong>${Number(bundle.credits) || 0}<small> credits</small></strong>
      <p>${Number(bundle.searches) || 0} extra checks</p>
      <small class="credit-pack-unit">${Math.round(Number(bundle.amountPence || 0) / Math.max(1, Number(bundle.searches) || 1))}p per check</small>
      <div class="credit-pack-price">${escapeHtml(formatMoney(bundle.amountPence, data.currency))}</div>
      <button class="primary-button" type="button" data-bundle-id="${escapeHtml(bundle.id)}" ${data.enabled ? "" : "disabled"}>${data.enabled ? `Choose ${escapeHtml(bundle.label)}` : "Coming soon"}</button>
    </article>`).join("");
  if (!data.enabled) setPurchaseStatus("Secure Stripe checkout is currently unavailable.");
}

creditPackGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-bundle-id]");
  if (button && !button.disabled) startCreditCheckout(button.dataset.bundleId, button);
});
buyAiQuestionsButton.addEventListener("click", buyAiQuestions);
plusPlanButton.addEventListener("click", handlePlus);

document.getElementById("signOutButton").addEventListener("click", async () => {
  setLoading(true);
  try {
    await window.biismoAuth.signOut();
    window.location.replace("/");
  } catch (error) {
    setLoading(false);
    setPurchaseStatus(error.message || "Sign out failed.", "error");
  }
});

async function initializeStore() {
  await window.biismoAuth.ready;
  if (!window.biismoAuth.isConfigured() || !window.biismoAuth.getUser()) {
    window.location.replace("/?login=1");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const purchaseResult = params.get("purchase");
  const plusResult = params.get("plus");
  if (purchaseResult === "success") setPurchaseStatus("Payment received. Your credits will appear automatically in a moment.", "success");
  else if (purchaseResult === "cancelled") setPurchaseStatus("Checkout cancelled. You have not been charged.");
  if (plusResult === "success") setPurchaseStatus("Check A Reg+ payment received. Activating your monthly benefits…", "success");
  else if (plusResult === "cancelled") setPurchaseStatus("Check A Reg+ checkout cancelled. You have not been charged.");

  try {
    await Promise.all([loadStore(), loadEntitlements(), loadPurchaseHistory()]);
    if (purchaseResult === "success" || plusResult === "success") {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        await Promise.all([loadEntitlements(), loadPurchaseHistory()]);
      }
    }
  } catch (error) {
    setPurchaseStatus(error.message || "Plans and credits could not be loaded.", "error");
  } finally {
    setLoading(false);
  }
}

initializeStore();
