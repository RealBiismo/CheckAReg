const garageGrid = document.getElementById("savedVehicles");
const garageStatus = document.getElementById("garageStatus");
const vehicleCount = document.getElementById("savedVehicleCount");
const accountEmail = document.getElementById("accountEmail");
const loadingOverlay = document.getElementById("loadingOverlay");
const freeSearchesRemaining = document.getElementById("freeSearchesRemaining");
const creditBalance = document.getElementById("creditBalance");
const accountMenu = document.getElementById("accountMenu");
const garageMenuButton = document.getElementById("garageMenuButton");
const adminMenuButton = document.getElementById("adminMenuButton");
const garageView = document.getElementById("garageView");
const adminView = document.getElementById("adminView");
const adminUserSearchForm = document.getElementById("adminUserSearchForm");
const adminUserEmail = document.getElementById("adminUserEmail");
const adminUserSearchButton = document.getElementById("adminUserSearchButton");
const adminStatus = document.getElementById("adminUserStatus");
const adminUserResult = document.getElementById("adminUserResult");
const adminCreditAmount = document.getElementById("adminCreditAmount");
const adminAddCreditsButton = document.getElementById("adminAddCreditsButton");
const adminSetCreditsButton = document.getElementById("adminSetCreditsButton");
const adminResetCreditsButton = document.getElementById("adminResetCreditsButton");
const reminderStatus = document.getElementById("reminderStatus");
const reminderToggleButton = document.getElementById("enableNotificationsButton");
const reminderVehicleList = document.getElementById("reminderVehicleList");
const adminNotificationTitle = document.getElementById("adminNotificationTitle");
const adminNotificationMessage = document.getElementById("adminNotificationMessage");
const adminSendNotificationButton = document.getElementById("adminSendNotificationButton");
const adminNotificationStatus = document.getElementById("adminNotificationStatus");
const broadcastAccountCount = document.getElementById("broadcastAccountCount");
const broadcastDeviceCount = document.getElementById("broadcastDeviceCount");
const notificationConsentModal = document.getElementById("notificationConsentModal");
const notificationAllowButton = document.getElementById("notificationAllowButton");
const notificationNotNowButton = document.getElementById("notificationNotNowButton");
const notificationBellButton = document.getElementById("notificationBellButton");
const notificationBadge = document.getElementById("notificationBadge");
const notificationDrawer = document.getElementById("notificationDrawer");
const notificationList = document.getElementById("notificationList");
const notificationDrawerStatus = document.getElementById("notificationDrawerStatus");
const markAllNotificationsReadButton = document.getElementById("markAllNotificationsReadButton");
const broadcastHistoryList = document.getElementById("broadcastHistoryList");

let hasAdminAccess = false;
let selectedAdminEmail = null;
let selectedPushDevices = 0;
let broadcastAccounts = 0;
let broadcastDevices = 0;
let broadcastRecipients = 0;

const NOTIFICATION_PROMPT_DISMISSED_KEY = "biismo-notification-prompt-dismissed-v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleDateString("en-GB");
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function renderNotificationBadge(count) {
  const unread = Math.max(0, Number(count) || 0);
  notificationBadge.textContent = unread > 99 ? "99+" : String(unread);
  notificationBadge.hidden = unread === 0;
  notificationBellButton.setAttribute("aria-label", unread ? `Open notifications, ${unread} unread` : "Open notifications");
}

function renderNotifications(items, unreadCount) {
  renderNotificationBadge(unreadCount);
  markAllNotificationsReadButton.disabled = !unreadCount;
  if (!items.length) {
    notificationList.innerHTML = '<p class="notification-empty">You have no notifications yet.</p>';
    return;
  }
  notificationList.innerHTML = items.map((item) => `
    <article class="notification-item ${item.read_at ? "" : "is-unread"}" data-notification-id="${escapeHtml(item.id)}">
      <div class="notification-item-top"><span>${escapeHtml(String(item.type || "update").toUpperCase())}</span><time>${escapeHtml(formatDateTime(item.created_at))}</time></div>
      <h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.message)}</p>
      <div class="notification-item-actions">
        ${item.read_at ? "" : '<button data-notification-read type="button">Mark read</button>'}
        <button data-notification-delete type="button">Delete</button>
      </div>
    </article>`).join("");
}

async function loadNotifications() {
  try {
    const response = await window.biismoAuth.authorizedFetch("/api/notifications", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Notifications could not be loaded.");
    renderNotifications(Array.isArray(data.notifications) ? data.notifications : [], data.unreadCount);
    notificationDrawerStatus.textContent = "";
  } catch (error) {
    notificationDrawerStatus.textContent = error.message || "Notifications could not be loaded.";
  }
}

async function updateNotification(url, options = {}) {
  const response = await window.biismoAuth.authorizedFetch(url, { method: options.method || "POST", headers: { "Content-Type": "application/json" }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Notification could not be updated.");
  await loadNotifications();
}

function setNotificationDrawer(open) {
  notificationDrawer.hidden = !open;
  notificationBellButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("has-open-drawer", open);
  if (open) loadNotifications();
}

function londonTodayUtc() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
}

function expiryDetails(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return { label: "Date unavailable", tone: "neutral" };
  }

  const [year, month, day] = value.split("-").map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);
  const days = Math.round((dueUtc - londonTodayUtc()) / 86400000);

  if (days < 0) {
    const elapsed = Math.abs(days);
    return { label: `Expired ${elapsed} ${elapsed === 1 ? "day" : "days"} ago`, tone: "bad" };
  }
  if (days === 0) return { label: "Due today", tone: "bad" };
  if (days === 1) return { label: "Due tomorrow", tone: "bad" };
  if (days <= 7) return { label: `Due in ${days} days`, tone: "bad" };
  if (days <= 30) return { label: `Due in ${days} days`, tone: "warning" };
  return { label: `Due in ${days} days`, tone: "good" };
}

function expiryBadge(value) {
  const details = expiryDetails(value);
  return `<span class="expiry-badge is-${details.tone}">${escapeHtml(details.label)}</span>`;
}

function setLoading(visible, title = "Opening your garage", message = "Loading your securely saved vehicles…") {
  loadingOverlay.classList.toggle("is-visible", visible);
  loadingOverlay.setAttribute("aria-hidden", String(!visible));
  loadingOverlay.querySelector("strong").textContent = title;
  loadingOverlay.querySelector("span").textContent = message;
}

function renderAllowance(allowance) {
  const free = Number(allowance.freeRemaining) || 0;
  const credits = Number(allowance.credits) || 0;
  freeSearchesRemaining.textContent = String(free);
  creditBalance.textContent = String(credits);
  hasAdminAccess = Boolean(allowance.isAdmin);
  accountMenu.hidden = !hasAdminAccess;
  if (hasAdminAccess) loadPushAudience();
  else switchAccountView("garage");
}

function switchAccountView(view) {
  const showAdmin = view === "admin" && hasAdminAccess;
  garageView.hidden = showAdmin;
  adminView.hidden = !showAdmin;
  garageMenuButton.classList.toggle("is-active", !showAdmin);
  adminMenuButton.classList.toggle("is-active", showAdmin);
  garageMenuButton.setAttribute("aria-selected", String(!showAdmin));
  adminMenuButton.setAttribute("aria-selected", String(showAdmin));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadAllowance() {
  try {
    const response = await window.biismoAuth.authorizedFetch("/api/allowance", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Your allowance could not be loaded.");
    renderAllowance(data);
  } catch (error) {
    freeSearchesRemaining.textContent = "—";
    creditBalance.textContent = "—";
    garageStatus.textContent = error.message || "Your allowance could not be loaded.";
  }
}

function renderEmptyGarage() {
  garageGrid.innerHTML = `
    <div class="empty-garage">
      <div class="empty-icon" aria-hidden="true">＋</div>
      <h3>Your garage is empty</h3>
      <p>Run a vehicle check, then choose “Save to garage” to keep it here.</p>
      <a class="primary-button button-link" href="/">Check a vehicle</a>
    </div>
  `;
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("untaxed") || value.includes("expired") || value.includes("not valid")) return "is-bad";
  if (value.includes("taxed") || value.includes("valid")) return "is-good";
  return "is-neutral";
}

function renderVehicles(vehicles) {
  vehicleCount.textContent = `${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"}`;
  garageStatus.textContent = "";

  if (vehicles.length === 0) {
    renderEmptyGarage();
    return;
  }

  garageGrid.innerHTML = vehicles
    .map(
      (vehicle) => `
        <article class="garage-card" data-vehicle-id="${escapeHtml(vehicle.id)}">
          <div class="garage-card-top">
            <div class="mini-plate"><span>GB</span>${escapeHtml(vehicle.registration)}</div>
            <button class="remove-vehicle" type="button" data-remove-id="${escapeHtml(vehicle.id)}" aria-label="Remove ${escapeHtml(vehicle.registration)} from garage">×</button>
          </div>
          <h3>${escapeHtml(vehicle.make || "Unknown make")} ${escapeHtml(vehicle.model || "")}</h3>
          <p class="vehicle-meta">${escapeHtml(vehicle.colour || "Colour unknown")}${vehicle.last_mileage ? ` · ${Number(vehicle.last_mileage).toLocaleString()} miles` : ""}</p>

          <div class="garage-status-grid">
            <div>
              <span>Tax</span>
              <strong class="${statusClass(vehicle.tax_status)}">${escapeHtml(vehicle.tax_status || "Unknown")}</strong>
              ${expiryBadge(vehicle.tax_due_date)}
              <small>${escapeHtml(formatDate(vehicle.tax_due_date))}</small>
            </div>
            <div>
              <span>MOT</span>
              <strong class="${statusClass(vehicle.mot_status)}">${escapeHtml(vehicle.mot_status || "See latest check")}</strong>
              ${expiryBadge(vehicle.mot_expiry_date)}
              <small>${escapeHtml(formatDate(vehicle.mot_expiry_date))}</small>
            </div>
          </div>

          <a class="card-action" href="/?reg=${encodeURIComponent(vehicle.registration)}">
            View latest check <span aria-hidden="true">→</span>
          </a>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-remove-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".garage-card");
      const registration = card.querySelector(".mini-plate").textContent.replace("GB", "").trim();
      if (!window.confirm(`Remove ${registration} from your garage?`)) return;

      button.disabled = true;
      try {
        await window.biismoAuth.removeSavedVehicle(button.dataset.removeId);
        card.remove();
        const remaining = document.querySelectorAll(".garage-card").length;
        vehicleCount.textContent = `${remaining} ${remaining === 1 ? "vehicle" : "vehicles"}`;
        if (remaining === 0) renderEmptyGarage();
      } catch (error) {
        garageStatus.textContent = error.message || "That vehicle could not be removed.";
        button.disabled = false;
      }
    });
  });
}

function setReminderStatus(message, type = "") {
  reminderStatus.textContent = message;
  reminderStatus.className = `reminder-status ${type ? `is-${type}` : ""}`.trim();
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function savePushSubscription(subscription) {
  const response = await window.biismoAuth.authorizedFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Reminders could not be enabled.");
  return data;
}

function selectedReminderCount() {
  return reminderVehicleList.querySelectorAll('input[type="checkbox"]:checked').length;
}

function updateReminderSelectionStatus() {
  const count = selectedReminderCount();
  setReminderStatus(
    count === 0
      ? "Notifications are enabled. Choose at least one saved registration below."
      : `Expiry reminders are active for ${count} saved ${count === 1 ? "vehicle" : "vehicles"}.`,
    count > 0 ? "success" : ""
  );
}

function renderReminderVehicles(vehicles) {
  reminderVehicleList.hidden = false;
  if (!vehicles.length) {
    reminderVehicleList.innerHTML = '<p class="reminder-vehicle-empty">Save a vehicle to your garage before choosing reminder registrations.</p>';
    return;
  }

  reminderVehicleList.innerHTML = vehicles
    .map((vehicle) => {
      const description = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Saved vehicle";
      return `
        <label class="reminder-vehicle-option">
          <input type="checkbox" data-reminder-vehicle-id="${escapeHtml(vehicle.vehicleId)}" ${vehicle.enabled ? "checked" : ""}>
          <span>
            <strong>${escapeHtml(vehicle.registration)}</strong>
            <small>${escapeHtml(description)}</small>
          </span>
        </label>
      `;
    })
    .join("");

  reminderVehicleList.querySelectorAll("[data-reminder-vehicle-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      try {
        const response = await window.biismoAuth.authorizedFetch("/api/reminders/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: checkbox.dataset.reminderVehicleId,
            enabled: checkbox.checked,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "That reminder choice could not be saved.");
        updateReminderSelectionStatus();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        setReminderStatus(error.message || "That reminder choice could not be saved.", "error");
      } finally {
        checkbox.disabled = false;
      }
    });
  });

  updateReminderSelectionStatus();
}

async function loadReminderVehicles() {
  try {
    const response = await window.biismoAuth.authorizedFetch("/api/reminders/preferences", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Vehicle reminder choices could not be loaded.");
    renderReminderVehicles(Array.isArray(data.vehicles) ? data.vehicles : []);
  } catch (error) {
    reminderVehicleList.hidden = true;
    setReminderStatus(error.message || "Vehicle reminder choices could not be loaded.", "error");
  }
}

function hideNotificationConsentPrompt() {
  notificationConsentModal.hidden = true;
}

function maybeShowNotificationConsentPrompt() {
  if (
    Notification.permission === "default" &&
    window.localStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) !== "true"
  ) {
    notificationConsentModal.hidden = false;
  }
}

async function enableRemindersOnDevice() {
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted. You can enable it later from your browser settings.");
  }

  const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
  const keyData = await keyResponse.json();
  if (!keyResponse.ok || !keyData.publicKey) {
    throw new Error(keyData.error || "Vehicle reminders are not available yet.");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(keyData.publicKey),
  });
  await savePushSubscription(subscription);
  window.localStorage.removeItem(NOTIFICATION_PROMPT_DISMISSED_KEY);
  reminderToggleButton.textContent = "Disable reminders";
  reminderToggleButton.dataset.enabled = "true";
  await loadReminderVehicles();
}

async function initializeReminders() {
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setReminderStatus("Push reminders are not supported by this browser.", "error");
    return;
  }
  if (iosDevice && !installed) {
    setReminderStatus("On iPhone, add CHECK A REG to your Home Screen before enabling reminders.");
    return;
  }
  if (Notification.permission === "denied") {
    setReminderStatus("Notifications are blocked. Allow them in your device settings to enable reminders.", "error");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await savePushSubscription(subscription);
      reminderToggleButton.textContent = "Disable reminders";
      reminderToggleButton.dataset.enabled = "true";
      await loadReminderVehicles();
    } else {
      reminderToggleButton.textContent = "Enable reminders";
      reminderToggleButton.dataset.enabled = "false";
      reminderVehicleList.hidden = true;
      setReminderStatus("Reminders are currently off on this device.");
      maybeShowNotificationConsentPrompt();
    }
    reminderToggleButton.disabled = false;
  } catch (error) {
    setReminderStatus(error.message || "Reminder settings could not be loaded.", "error");
  }
}

reminderToggleButton.addEventListener("click", async () => {
  reminderToggleButton.disabled = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      const response = await window.biismoAuth.authorizedFetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: existing.endpoint }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reminders could not be disabled.");
      await existing.unsubscribe();
      reminderToggleButton.textContent = "Enable reminders";
      reminderToggleButton.dataset.enabled = "false";
      reminderVehicleList.hidden = true;
      setReminderStatus("Reminders are off on this device.", "success");
      return;
    }

    await enableRemindersOnDevice();
  } catch (error) {
    setReminderStatus(error.message || "Reminder settings could not be changed.", "error");
  } finally {
    reminderToggleButton.disabled = false;
  }
});

notificationAllowButton.addEventListener("click", async () => {
  notificationAllowButton.disabled = true;
  notificationNotNowButton.disabled = true;
  hideNotificationConsentPrompt();
  reminderToggleButton.disabled = true;
  try {
    await enableRemindersOnDevice();
  } catch (error) {
    setReminderStatus(error.message || "Notifications could not be enabled.", "error");
  } finally {
    notificationAllowButton.disabled = false;
    notificationNotNowButton.disabled = false;
    reminderToggleButton.disabled = false;
  }
});

notificationNotNowButton.addEventListener("click", () => {
  window.localStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, "true");
  hideNotificationConsentPrompt();
  setReminderStatus("Notifications are off. You can enable them here whenever you want.");
});

async function loadGarage() {
  await window.biismoAuth.ready;

  if (!window.biismoAuth.isConfigured()) {
    setLoading(false);
    accountEmail.textContent = "Account setup is not complete yet.";
    garageStatus.textContent = "Add the Supabase project URL and public key to enable secure accounts.";
    renderEmptyGarage();
    return;
  }

  const user = window.biismoAuth.getUser();
  if (!user) {
    window.location.replace("/?login=1");
    return;
  }

  accountEmail.textContent = user.email || "Signed in securely";
  loadAllowance();
  initializeReminders();
  loadNotifications();
  if (new URLSearchParams(window.location.search).has("notifications")) setNotificationDrawer(true);

  try {
    const vehicles = await window.biismoAuth.listSavedVehicles();
    renderVehicles(vehicles);
  } catch (error) {
    garageStatus.textContent = error.message || "Your saved vehicles could not be loaded.";
    garageGrid.innerHTML = "";
  } finally {
    setLoading(false);
  }
}

function setAdminStatus(message, type = "") {
  adminStatus.textContent = message;
  adminStatus.className = `admin-status ${type ? `is-${type}` : ""}`.trim();
}

function setAdminNotificationStatus(message, type = "") {
  adminNotificationStatus.textContent = message;
  adminNotificationStatus.className = `admin-status ${type ? `is-${type}` : ""}`.trim();
}

function setAdminBusy(busy) {
  adminUserSearchButton.disabled = busy;
  adminAddCreditsButton.disabled = busy;
  adminSetCreditsButton.disabled = busy;
  adminResetCreditsButton.disabled = busy;
  adminSendNotificationButton.disabled = busy || broadcastRecipients === 0;
}

function renderAdminUser(account) {
  selectedAdminEmail = account.email;
  selectedPushDevices = Number(account.pushDevices) || 0;
  document.getElementById("selectedUserEmail").textContent = account.email;
  document.getElementById("selectedUserCredits").textContent = String(Number(account.credits) || 0);
  document.getElementById("selectedUserSearches").textContent = String(Number(account.searchesToday ?? account.freeUsed) || 0);
  document.getElementById("selectedUserVehicles").textContent = String(Number(account.savedVehicles ?? account.vehicleCount) || 0);
  adminUserResult.hidden = false;
}

async function postAdminAction(url, body) {
  const response = await window.biismoAuth.authorizedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The admin action could not be completed.");
  return data;
}

async function findAdminUser(email, showLoading = true) {
  if (showLoading) setAdminStatus("Searching verified accounts…");
  const account = await postAdminAction("/api/admin/user-credits", { email });
  renderAdminUser(account);
  return account;
}

async function loadPushAudience() {
  try {
    const response = await window.biismoAuth.authorizedFetch("/api/admin/push-audience", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The push audience could not be loaded.");
    broadcastAccounts = Number(data.accounts) || 0;
    broadcastDevices = Number(data.devices) || 0;
    broadcastRecipients = Number(data.recipients ?? data.totalAccounts ?? data.accounts) || 0;
    broadcastAccountCount.textContent = String(broadcastAccounts);
    broadcastDeviceCount.textContent = String(broadcastDevices);
    adminSendNotificationButton.disabled = broadcastRecipients === 0;
    setAdminNotificationStatus(
      broadcastDevices > 0
        ? `Ready to reach ${broadcastAccounts} opted-in ${broadcastAccounts === 1 ? "account" : "accounts"} across ${broadcastDevices} ${broadcastDevices === 1 ? "device" : "devices"}.`
        : "No accounts have enabled push notifications yet. Announcements will still appear in the in-app inbox."
    );
  } catch (error) {
    broadcastAccounts = 0;
    broadcastDevices = 0;
    broadcastAccountCount.textContent = "—";
    broadcastDeviceCount.textContent = "—";
    adminSendNotificationButton.disabled = true;
    setAdminNotificationStatus(error.message || "The push audience could not be loaded.", "error");
  }
}

async function loadBroadcastHistory() {
  try {
    const response = await window.biismoAuth.authorizedFetch("/api/admin/broadcast-history", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Broadcast history could not be loaded.");
    const items = Array.isArray(data.broadcasts) ? data.broadcasts : [];
    broadcastHistoryList.innerHTML = items.length ? items.map((item) => `
      <article class="broadcast-history-item"><div><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDateTime(item.created_at))}</time></div>
      <p>${escapeHtml(item.message)}</p><small>${Number(item.recipients)||0} recipients · ${Number(item.devices)||0} devices · ${Number(item.sent)||0} sent · ${Number(item.failed)||0} failed</small></article>`).join("") : '<p class="notification-empty">No broadcasts yet.</p>';
  } catch (error) {
    broadcastHistoryList.innerHTML = `<p class="notification-empty">${escapeHtml(error.message || "Broadcast history could not be loaded.")}</p>`;
  }
}

garageMenuButton.addEventListener("click", () => switchAccountView("garage"));
adminMenuButton.addEventListener("click", () => { switchAccountView("admin"); loadBroadcastHistory(); });

adminUserSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = adminUserEmail.value.trim().toLowerCase();

  if (!adminUserEmail.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    setAdminStatus("Enter a complete account email address.", "error");
    return;
  }

  setAdminBusy(true);
  adminUserResult.hidden = true;
  selectedAdminEmail = null;
  selectedPushDevices = 0;
  try {
    await findAdminUser(email);
    setAdminStatus("User found.", "success");
  } catch (error) {
    setAdminStatus(error.message || "That user could not be found.", "error");
  } finally {
    setAdminBusy(false);
  }
});

adminAddCreditsButton.addEventListener("click", async () => {
  const amount = Number(adminCreditAmount.value);
  if (!selectedAdminEmail) return;
  if (adminCreditAmount.value.trim() === "" || !Number.isInteger(amount) || amount < 1 || amount > 100000) {
    setAdminStatus("Enter a whole number between 1 and 100,000 to add.", "error");
    return;
  }

  setAdminBusy(true);
  setAdminStatus(`Adding ${amount} credits…`);
  try {
    await postAdminAction("/api/grant-credits", { email: selectedAdminEmail, amount });
    const account = await findAdminUser(selectedAdminEmail, false);
    adminCreditAmount.value = "";
    setAdminStatus(`${amount} credits added. ${account.email} now has ${account.credits}.`, "success");
    await loadAllowance();
  } catch (error) {
    setAdminStatus(error.message || "Credits could not be added.", "error");
  } finally {
    setAdminBusy(false);
  }
});

adminSetCreditsButton.addEventListener("click", async () => {
  const amount = Number(adminCreditAmount.value);
  if (!selectedAdminEmail) return;
  if (adminCreditAmount.value.trim() === "" || !Number.isInteger(amount) || amount < 0 || amount > 100000) {
    setAdminStatus("Enter an exact balance between 0 and 100,000.", "error");
    return;
  }

  setAdminBusy(true);
  setAdminStatus(`Setting the balance to ${amount}…`);
  try {
    await postAdminAction("/api/admin/set-credits", { email: selectedAdminEmail, amount });
    const account = await findAdminUser(selectedAdminEmail, false);
    adminCreditAmount.value = "";
    setAdminStatus(`${account.email} now has exactly ${account.credits} credits.`, "success");
    await loadAllowance();
  } catch (error) {
    setAdminStatus(error.message || "The credit balance could not be changed.", "error");
  } finally {
    setAdminBusy(false);
  }
});

adminResetCreditsButton.addEventListener("click", async () => {
  if (!selectedAdminEmail) return;
  if (!window.confirm(`Reset ${selectedAdminEmail}'s credit balance to 0?`)) return;

  setAdminBusy(true);
  setAdminStatus("Resetting the credit balance…");
  try {
    await postAdminAction("/api/admin/set-credits", { email: selectedAdminEmail, amount: 0 });
    const account = await findAdminUser(selectedAdminEmail, false);
    adminCreditAmount.value = "";
    setAdminStatus(`${account.email}'s credits have been reset to 0.`, "success");
    await loadAllowance();
  } catch (error) {
    setAdminStatus(error.message || "The credit balance could not be reset.", "error");
  } finally {
    setAdminBusy(false);
  }
});

adminSendNotificationButton.addEventListener("click", async () => {
  if (broadcastRecipients === 0) return;

  const title = adminNotificationTitle.value.trim();
  const message = adminNotificationMessage.value.trim();
  if (title.length < 1 || title.length > 80) {
    setAdminNotificationStatus("Enter a notification title between 1 and 80 characters.", "error");
    return;
  }
  if (message.length < 1 || message.length > 240) {
    setAdminNotificationStatus("Enter a notification message between 1 and 240 characters.", "error");
    return;
  }
  if (!window.confirm(`Send this announcement to all ${broadcastRecipients} ${broadcastRecipients === 1 ? "account" : "accounts"}? Push will also go to ${broadcastDevices} enabled ${broadcastDevices === 1 ? "device" : "devices"}.`)) return;

  setAdminBusy(true);
  setAdminNotificationStatus(`Broadcasting to ${broadcastDevices} enabled ${broadcastDevices === 1 ? "device" : "devices"}…`);
  try {
    const result = await postAdminAction("/api/admin/send-broadcast", {
      title,
      message,
    });
    adminNotificationMessage.value = "";
    await Promise.all([loadPushAudience(), loadBroadcastHistory(), loadNotifications()]);
    if (result.failed > 0) {
      setAdminNotificationStatus(`Sent to ${result.sent} devices; ${result.failed} failed.`, "error");
    } else {
      setAdminNotificationStatus(`Broadcast sent to ${result.sent} ${result.sent === 1 ? "device" : "devices"}.`, "success");
    }
  } catch (error) {
    setAdminNotificationStatus(error.message || "The push notification could not be sent.", "error");
  } finally {
    setAdminBusy(false);
  }
});

notificationBellButton.addEventListener("click", () => setNotificationDrawer(true));
document.getElementById("closeNotificationDrawerButton").addEventListener("click", () => setNotificationDrawer(false));
document.getElementById("notificationDrawerBackdrop").addEventListener("click", () => setNotificationDrawer(false));
document.getElementById("refreshBroadcastHistoryButton").addEventListener("click", loadBroadcastHistory);
markAllNotificationsReadButton.addEventListener("click", async () => {
  try { await updateNotification("/api/notifications/read-all"); } catch (error) { notificationDrawerStatus.textContent = error.message; }
});
notificationList.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-notification-id]");
  if (!item) return;
  try {
    if (event.target.closest("[data-notification-read]")) await updateNotification(`/api/notifications/${item.dataset.notificationId}/read`, { body: { read: true } });
    if (event.target.closest("[data-notification-delete]")) await updateNotification(`/api/notifications/${item.dataset.notificationId}`, { method: "DELETE" });
  } catch (error) { notificationDrawerStatus.textContent = error.message; }
});

document.getElementById("garageSearchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const registration = document
    .getElementById("garageRegInput")
    .value.toUpperCase()
    .replace(/[\s-]/g, "");

  if (!/^[A-Z0-9]{2,8}$/.test(registration) || !/[A-Z]/.test(registration) || !/[0-9]/.test(registration)) {
    garageStatus.textContent = "Enter a valid UK registration number.";
    return;
  }

  window.location.href = `/?reg=${encodeURIComponent(registration)}`;
});

document.getElementById("signOutButton").addEventListener("click", async () => {
  setLoading(true, "Signing you out", "Ending the secure session…");
  try {
    await window.biismoAuth.signOut();
    window.location.replace("/");
  } catch (error) {
    setLoading(false);
    garageStatus.textContent = error.message || "Sign out failed. Please try again.";
  }
});

loadGarage();
