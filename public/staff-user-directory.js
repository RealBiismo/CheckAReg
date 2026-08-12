(() => {
  if (window.location.pathname !== "/account.html") return;

  const byId = (id) => document.getElementById(id);
  let clientPromise = null;
  let accounts = [];
  let selectedEmail = "";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        await window.biismoAuth.ready;
        const response = await fetch("/api/config", { cache: "no-store" });
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "Staff directory unavailable.");
        const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("Sign in again to view accounts.");
        return client;
      })();
    }
    return clientPromise;
  }

  async function rpc(name, params = {}) {
    const client = await getClient();
    const { data, error } = await client.rpc(name, params);
    if (error) throw new Error(error.message || "Staff action failed.");
    return data;
  }

  function role() {
    return document.body.dataset.staffRole || "";
  }

  function waitForRole() {
    return new Promise((resolve) => {
      if (role()) return resolve(role());
      const observer = new MutationObserver(() => {
        if (!role()) return;
        observer.disconnect();
        resolve(role());
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["data-staff-role"] });
      window.setTimeout(() => {
        observer.disconnect();
        resolve(role() || "user");
      }, 5000);
    });
  }

  function injectStylesheet() {
    if (document.querySelector('link[href="/staff-user-directory.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/staff-user-directory.css";
    document.head.append(link);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function renderDirectory(filter = "") {
    const list = byId("staffUserDirectoryList");
    const count = byId("staffUserDirectoryCount");
    if (!list) return;
    const needle = String(filter || "").trim().toLowerCase();
    const filtered = accounts.filter((item) => !needle || String(item.email || "").includes(needle));
    if (count) count.textContent = `${filtered.length} of ${accounts.length} accounts`;
    list.innerHTML = filtered.length
      ? filtered.map((item) => `
        <button class="staff-user-row${item.email === selectedEmail ? " is-selected" : ""}" type="button" data-user-email="${escapeHtml(item.email)}">
          <span class="staff-user-main">
            <strong>${escapeHtml(item.email)}</strong>
            <small>${escapeHtml(item.role)} · ${item.verified ? "Verified" : "Unverified"}${item.banned ? " · Banned" : ""}</small>
          </span>
          <span class="staff-user-meta">
            <span>${Number(item.credits) || 0} credits</span>
            <span>${Number(item.total_searches) || 0} searches</span>
            <span>Joined ${escapeHtml(formatDate(item.created_at))}</span>
          </span>
          <span class="staff-user-chevron" aria-hidden="true">›</span>
        </button>`).join("")
      : '<p class="notification-empty">No matching accounts.</p>';
  }

  function markSelected(email) {
    selectedEmail = email;
    document.querySelectorAll(".staff-user-row").forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.userEmail === email);
    });
  }

  function closeDrawer() {
    const shell = byId("staffUserDrawer");
    if (!shell) return;
    shell.classList.remove("is-open");
    shell.setAttribute("aria-hidden", "true");
    document.body.classList.remove("staff-user-drawer-open");
  }

  function openDrawer() {
    const shell = byId("staffUserDrawer");
    if (!shell) return;
    shell.classList.add("is-open");
    shell.setAttribute("aria-hidden", "false");
    document.body.classList.add("staff-user-drawer-open");
    window.setTimeout(() => byId("staffUserDrawerClose")?.focus(), 30);
  }

  function buildDrawer() {
    if (byId("staffUserDrawer")) return;
    const result = byId("adminUserResult");
    if (!result) return;

    const shell = document.createElement("div");
    shell.id = "staffUserDrawer";
    shell.className = "staff-user-drawer";
    shell.setAttribute("aria-hidden", "true");
    shell.innerHTML = `
      <button class="staff-user-drawer-backdrop" type="button" aria-label="Close user details"></button>
      <aside class="staff-user-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="staffUserDrawerTitle">
        <header class="staff-user-drawer-header">
          <div><span class="eyebrow">ACCOUNT</span><h2 id="staffUserDrawerTitle">User details</h2></div>
          <button id="staffUserDrawerClose" class="staff-user-drawer-close" type="button" aria-label="Close user details">×</button>
        </header>
        <div id="staffUserDrawerContent" class="staff-user-drawer-content"></div>
      </aside>`;
    document.body.append(shell);
    byId("staffUserDrawerContent")?.append(result);

    shell.querySelector(".staff-user-drawer-backdrop")?.addEventListener("click", closeDrawer);
    byId("staffUserDrawerClose")?.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && shell.classList.contains("is-open")) closeDrawer();
    });
  }

  function showSelectedResult() {
    const result = byId("adminUserResult");
    if (!result) return;
    result.dataset.accountSelected = "true";
    result.hidden = false;
    openDrawer();
  }

  function ensureOwnerRoleAction(email) {
    if (role() !== "owner") return;
    const result = byId("adminUserResult");
    const heading = result?.querySelector(".admin-user-heading");
    if (!result || !heading) return;

    let panel = byId("staffSelectedRoleAction");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "staffSelectedRoleAction";
      panel.className = "staff-selected-role-action";
      heading.after(panel);
    }

    const account = accounts.find((item) => item.email === email);
    if (!account) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    if (account.role === "owner" || account.role === "admin") {
      panel.innerHTML = `<div><span class="eyebrow">STAFF ROLE</span><strong>${escapeHtml(account.role)}</strong><small>This protected staff role cannot be changed here.</small></div>`;
      return;
    }

    const isModerator = account.role === "moderator";
    panel.innerHTML = `
      <div><span class="eyebrow">STAFF ROLE</span><strong>${isModerator ? "Moderator" : "Standard user"}</strong><small>${isModerator ? "Remove moderator access from this account." : "Give this account moderator support access."}</small></div>
      <button id="staffToggleModeratorButton" class="${isModerator ? "danger-button" : "secondary-button"} compact-button" type="button">${isModerator ? "Remove moderator" : "Make moderator"}</button>
      <p id="staffRoleActionStatus" class="admin-status" role="status"></p>`;

    byId("staffToggleModeratorButton")?.addEventListener("click", async () => {
      const button = byId("staffToggleModeratorButton");
      const status = byId("staffRoleActionStatus");
      if (button) button.disabled = true;
      if (status) status.textContent = isModerator ? "Removing moderator access…" : "Adding moderator access…";
      try {
        await rpc("owner_set_moderator", { p_target_email: email, p_enabled: !isModerator });
        await loadAccounts();
        ensureOwnerRoleAction(email);
        if (status) status.textContent = isModerator ? "Moderator access removed." : "Moderator access added.";
      } catch (error) {
        if (status) status.textContent = error.message || "Staff role could not be changed.";
        if (button) button.disabled = false;
      }
    });
  }

  async function selectModeratorAccount(email) {
    const account = await rpc("admin_get_user_credits", { p_target_email: email });
    byId("selectedUserEmail").textContent = account.email;
    byId("selectedUserCredits").textContent = String(Number(account.credits) || 0);
    byId("selectedUserFreeRemaining").textContent = String(Number(account.freeRemaining) || 0);
    byId("selectedUserFreeUsed").textContent = String(Number(account.freeUsed) || 0);
    byId("selectedUserPushDevices").textContent = String(Number(account.pushDevices) || 0);
    const badge = byId("adminAccountStatusBadge");
    if (badge) {
      badge.textContent = account.banned ? "Banned" : account.verified ? "Active" : "Unverified";
      badge.className = `account-status-badge ${account.banned ? "is-banned" : "is-active"}`;
    }
    showSelectedResult();
  }

  async function selectAccount(email) {
    if (!email) return;
    markSelected(email);
    const input = byId("adminUserEmail");
    if (input) input.value = email;

    if (role() === "moderator") {
      try {
        await selectModeratorAccount(email);
      } catch (error) {
        const result = byId("adminUserResult");
        if (result) {
          showSelectedResult();
          result.insertAdjacentHTML("afterbegin", `<p class="admin-status is-error">${escapeHtml(error.message)}</p>`);
        }
      }
      return;
    }

    const form = byId("adminUserSearchForm");
    if (form) form.requestSubmit();
  }

  function watchSelectedAccount() {
    const emailNode = byId("selectedUserEmail");
    if (!emailNode) return;
    const update = () => {
      const email = String(emailNode.textContent || "").replace("♛", "").trim().toLowerCase();
      if (!email.includes("@")) return;
      markSelected(email);
      const title = byId("staffUserDrawerTitle");
      if (title) title.textContent = email;
      showSelectedResult();
      ensureOwnerRoleAction(email);
    };
    new MutationObserver(update).observe(emailNode, { childList: true, subtree: true, characterData: true });
  }

  function watchActivityRows() {
    const adminView = byId("adminView");
    if (!adminView) return;
    adminView.addEventListener("click", (event) => {
      const row = event.target.closest("[data-account-email]");
      if (!row) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void selectAccount(row.dataset.accountEmail);
    }, true);
  }

  function buildDirectory() {
    const panel = document.querySelector(".admin-user-panel");
    const form = byId("adminUserSearchForm");
    const result = byId("adminUserResult");
    if (!panel || !form || byId("staffUserDirectory")) return;

    const heading = panel.querySelector(".admin-panel-heading");
    if (heading) {
      const eyebrow = heading.querySelector(".eyebrow");
      const title = heading.querySelector("h2");
      const rate = heading.querySelector(".credit-rate");
      if (eyebrow) eyebrow.textContent = "USERS";
      if (title) title.textContent = "Accounts";
      if (rate) rate.textContent = "Click an email to open actions";
    }

    form.hidden = true;
    const status = byId("adminUserStatus");
    if (status && result) {
      status.hidden = false;
      result.prepend(status);
    }

    result.hidden = true;
    delete result.dataset.accountSelected;

    const directory = document.createElement("section");
    directory.id = "staffUserDirectory";
    directory.className = "staff-user-directory";
    directory.innerHTML = `
      <div class="staff-user-directory-toolbar">
        <label class="sr-only" for="staffUserDirectoryFilter">Filter accounts by email</label>
        <input id="staffUserDirectoryFilter" type="search" placeholder="Search accounts…" autocomplete="off">
        <span id="staffUserDirectoryCount">Loading accounts…</span>
      </div>
      <div id="staffUserDirectoryList" class="staff-user-directory-list"><p class="notification-empty">Loading accounts…</p></div>`;

    panel.insertBefore(directory, result);

    byId("staffUserDirectoryFilter")?.addEventListener("input", (event) => renderDirectory(event.target.value));
    byId("staffUserDirectoryList")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-user-email]");
      if (!row) return;
      void selectAccount(row.dataset.userEmail);
    });
  }

  async function loadAccounts() {
    const list = byId("staffUserDirectoryList");
    try {
      const data = await rpc("staff_list_accounts");
      accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      renderDirectory(byId("staffUserDirectoryFilter")?.value || "");
      if (selectedEmail) ensureOwnerRoleAction(selectedEmail);
    } catch (error) {
      if (list) list.innerHTML = `<p class="notification-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  async function init() {
    const staffRole = await waitForRole();
    if (!staffRole || staffRole === "user") return;
    injectStylesheet();
    buildDirectory();
    buildDrawer();
    watchSelectedAccount();
    watchActivityRows();
    await loadAccounts();
  }

  void init();
})();
