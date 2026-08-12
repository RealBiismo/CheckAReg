const openedSection = document.getElementById("openedNotificationSection");
const openedTitle = document.getElementById("openedNotificationHeading");
const openedMessage = document.getElementById("openedNotificationMessage");
const openedType = document.getElementById("openedNotificationType");
const openedSource = document.getElementById("openedNotificationSource");
const statusElement = document.getElementById("notificationsStatus");
const listElement = document.getElementById("notificationsList");
const markAllReadButton = document.getElementById("markAllReadButton");

const openedParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const tappedTitle = openedParams.get("title") || "";
const tappedMessage = openedParams.get("message") || "";
const tappedTag = openedParams.get("tag") || "";
const tappedSource = openedParams.get("source") || "/account.html";
let retryTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function notificationTypeFromTag(tag) {
  const value = String(tag || "").toLowerCase();
  if (value.includes("mot")) return "MOT";
  if (value.includes("tax")) return "TAX";
  if (value.includes("broadcast")) return "ANNOUNCEMENT";
  if (value.includes("admin")) return "MESSAGE";
  return "UPDATE";
}

function renderOpenedNotification() {
  if (!tappedTitle && !tappedMessage) return;

  openedSection.hidden = false;
  openedTitle.textContent = tappedTitle || "BIISMO REG notification";
  openedMessage.textContent = tappedMessage || "Open your inbox below for the full update.";
  openedType.textContent = notificationTypeFromTag(tappedTag);

  try {
    const source = new URL(tappedSource, window.location.origin);
    if (source.origin !== window.location.origin) throw new Error("Unsafe notification URL");
    openedSource.href = `${source.pathname}${source.search}${source.hash}`;
  } catch {
    openedSource.href = "/account.html";
  }
}

async function authorizedJson(url, options = {}) {
  const response = await window.biismoAuth.authorizedFetch(url, {
    method: options.method || "GET",
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "That notification action could not be completed.");
  return data;
}

function isTappedMatch(item) {
  return Boolean(
    tappedTitle &&
    tappedMessage &&
    String(item.title || "") === tappedTitle &&
    String(item.message || "") === tappedMessage
  );
}

function renderInbox(items, unreadCount) {
  markAllReadButton.disabled = Number(unreadCount) === 0;

  if (!items.length) {
    listElement.innerHTML = '<p class="notification-empty">You have no saved notifications yet.</p>';
    return;
  }

  listElement.innerHTML = items.map((item) => {
    const match = isTappedMatch(item);
    return `
      <article class="notification-row ${item.read_at ? "" : "is-unread"} ${match ? "is-opened-match" : ""}" data-notification-id="${escapeHtml(item.id)}">
        <div class="notification-row-top">
          <span>${escapeHtml(String(item.type || "update").toUpperCase())}${match ? " · OPENED" : ""}</span>
          <time>${escapeHtml(formatDateTime(item.created_at))}</time>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.message)}</p>
        <div class="notification-row-actions">
          ${item.read_at ? "" : '<button data-read type="button">Mark read</button>'}
          <button data-delete type="button">Delete</button>
        </div>
      </article>`;
  }).join("");
}

async function markTappedMatchRead(items) {
  const match = items.find((item) => isTappedMatch(item));
  if (!match || match.read_at) return false;

  try {
    await authorizedJson(`/api/notifications/${encodeURIComponent(match.id)}/read`, {
      method: "POST",
      body: { read: true },
    });
    match.read_at = new Date().toISOString();
    return true;
  } catch {
    return false;
  }
}

async function loadInbox(allowRetry = true) {
  clearTimeout(retryTimer);
  try {
    const data = await authorizedJson("/api/notifications");
    const items = Array.isArray(data.notifications) ? data.notifications : [];
    await markTappedMatchRead(items);
    renderInbox(items, data.unreadCount);

    const hasMatch = items.some((item) => isTappedMatch(item));
    statusElement.textContent = hasMatch
      ? "Opened notification highlighted below."
      : tappedTitle || tappedMessage
        ? "The notification is shown above. Your inbox is syncing…"
        : "";

    if (!hasMatch && allowRetry && (tappedTitle || tappedMessage)) {
      retryTimer = window.setTimeout(() => loadInbox(false), 1400);
    }
  } catch (error) {
    statusElement.textContent = error.message || "Notifications could not be loaded.";
  }
}

markAllReadButton.addEventListener("click", async () => {
  markAllReadButton.disabled = true;
  try {
    await authorizedJson("/api/notifications/read-all", { method: "POST" });
    await loadInbox(false);
  } catch (error) {
    statusElement.textContent = error.message || "Notifications could not be updated.";
    markAllReadButton.disabled = false;
  }
});

listElement.addEventListener("click", async (event) => {
  const row = event.target.closest("[data-notification-id]");
  if (!row) return;

  try {
    if (event.target.closest("[data-read]")) {
      await authorizedJson(`/api/notifications/${encodeURIComponent(row.dataset.notificationId)}/read`, {
        method: "POST",
        body: { read: true },
      });
      await loadInbox(false);
    }
    if (event.target.closest("[data-delete]")) {
      await authorizedJson(`/api/notifications/${encodeURIComponent(row.dataset.notificationId)}`, {
        method: "DELETE",
      });
      await loadInbox(false);
    }
  } catch (error) {
    statusElement.textContent = error.message || "That notification could not be updated.";
  }
});

async function initializeNotificationsPage() {
  renderOpenedNotification();
  await window.biismoAuth.ready;

  if (!window.biismoAuth.isConfigured()) {
    statusElement.textContent = "Account services are not configured.";
    return;
  }

  if (!window.biismoAuth.getUser()) {
    window.location.replace("/?login=1");
    return;
  }

  await loadInbox(true);
}

initializeNotificationsPage();
