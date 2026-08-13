(() => {
  const OWNER_EMAIL = "cybzerohq@gmail.com";
  const byId = (id) => document.getElementById(id);

  const adminMenuButton = byId("adminMenuButton");
  const adminUserSearchForm = byId("adminUserSearchForm");
  const adminUserEmail = byId("adminUserEmail");
  const adminUserSearchButton = byId("adminUserSearchButton");
  const adminStatus = byId("adminUserStatus");
  const adminUserResult = byId("adminUserResult");
  const selectedUserEmail = byId("selectedUserEmail");
  const selectedUserCredits = byId("selectedUserCredits");
  const selectedUserFreeRemaining = byId("selectedUserFreeRemaining");
  const selectedUserFreeUsed = byId("selectedUserFreeUsed");
  const selectedUserPushDevices = byId("selectedUserPushDevices");
  const adminAccountStatusBadge = byId("adminAccountStatusBadge");
  const adminCreditAmount = byId("adminCreditAmount");
  const adminAddCreditsButton = byId("adminAddCreditsButton");
  const adminSetCreditsButton = byId("adminSetCreditsButton");
  const adminResetCreditsButton = byId("adminResetCreditsButton");
  const adminBanUserButton = byId("adminBanUserButton");
  const adminDirectNotificationTitle = byId("adminDirectNotificationTitle");
  const adminDirectNotificationMessage = byId("adminDirectNotificationMessage");
  const adminDirectNotificationButton = byId("adminDirectNotificationButton");
  const adminDirectNotificationStatus = byId("adminDirectNotificationStatus");
  const adminDashboardRefreshButton = byId("adminDashboardRefreshButton");
  const adminHistoryToggleButton = byId("adminHistoryToggleButton");
  const adminBroadcastHistoryPanel = byId("adminBroadcastHistoryPanel");
  const refreshBroadcastHistoryButton = byId("refreshBroadcastHistoryButton");
  const broadcastHistoryList = byId("broadcastHistoryList");
  const recentSignupsList = byId("recentSignupsList");
  const recentSearchesList = byId("recentSearchesList");
  const bannedUsersList = byId("bannedUsersList");
  const accountEmail = byId("accountEmail");

  let selectedAccount = null;
  let rpcClientPromise = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Unknown time"
      : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }

  function ownerCrown() {
    return '<span class="owner-crown" role="img" aria-label="Owner account" title="CHECK A REG owner">♛</span>';
  }

  function emailMarkup(email, isOwner = false) {
    return `<span>${escapeHtml(email)}</span>${isOwner ? ownerCrown() : ""}`;
  }

  function setAdminStatus(message, type = "") {
    adminStatus.textContent = message;
    adminStatus.className = `admin-status ${type ? `is-${type}` : ""}`.trim();
  }

  function setDirectStatus(message, type = "") {
    adminDirectNotificationStatus.textContent = message;
    adminDirectNotificationStatus.className = `admin-status ${type ? `is-${type}` : ""}`.trim();
  }

  function setBusy(busy) {
    [
      adminUserSearchButton,
      adminAddCreditsButton,
      adminSetCreditsButton,
      adminResetCreditsButton,
      adminBanUserButton,
      adminDirectNotificationButton,
    ].forEach((button) => {
      if (button) button.disabled = busy || (button === adminBanUserButton && Boolean(selectedAccount?.isAdmin));
    });
  }

  async function getRpcClient() {
    if (!rpcClientPromise) {
      rpcClientPromise = (async () => {
        await window.biismoAuth.ready;
        const client = window.biismoAuth.getClient?.();
        if (!client || !window.biismoAuth.getUser?.()) {
          throw new Error("Sign in again to use the admin dashboard.");
        }
        return client;
      })();
    }
    return rpcClientPromise;
  }

  async function rpc(functionName, parameters = {}) {
    const client = await getRpcClient();
    const { data, error } = await client.rpc(functionName, parameters);
    if (error) throw new Error(error.message || "The admin action could not be completed.");
    return data;
  }

  async function postAdmin(url, body) {
    const response = await window.biismoAuth.authorizedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The admin action could not be completed.");
    return data;
  }

  function decorateCurrentOwner() {
    const user = window.biismoAuth?.getUser?.();
    if (!accountEmail || String(user?.email || "").toLowerCase() !== OWNER_EMAIL) return;
    if (accountEmail.querySelector(".owner-crown")) return;
    accountEmail.innerHTML = emailMarkup(OWNER_EMAIL, true);
    accountEmail.classList.add("owner-email-line");
  }

  function renderAccount(account) {
    selectedAccount = account;
    selectedUserEmail.innerHTML = emailMarkup(account.email, Boolean(account.isOwner));
    selectedUserEmail.classList.toggle("is-owner", Boolean(account.isOwner));
    selectedUserCredits.textContent = String(Number(account.credits) || 0);
    selectedUserFreeRemaining.textContent = String(Number(account.freeRemaining) || 0);
    selectedUserFreeUsed.textContent = String(Number(account.freeUsed) || 0);
    selectedUserPushDevices.textContent = String(Number(account.pushDevices) || 0);

    const protectedAccount = Boolean(account.isAdmin);
    adminAccountStatusBadge.textContent = account.banned ? "Banned" : protectedAccount ? "Admin protected" : "Active";
    adminAccountStatusBadge.className = `account-status-badge ${account.banned ? "is-banned" : protectedAccount ? "is-protected" : "is-active"}`;
    adminBanUserButton.disabled = protectedAccount;
    adminBanUserButton.textContent = protectedAccount ? "Admin account protected" : account.banned ? "Unban account" : "Ban account";
    adminBanUserButton.classList.toggle("is-unban", Boolean(account.banned));
    adminUserResult.hidden = false;
  }

  async function searchAccount(email, message = "Searching verified accounts…") {
    const normalized = String(email || "").trim().toLowerCase();
    if (!validEmail(normalized)) throw new Error("Enter a complete account email address.");
    setAdminStatus(message);
    const account = await postAdmin("/api/admin/user-credits", { email: normalized });
    renderAccount(account);
    adminUserEmail.value = normalized;
    return account;
  }

  async function refreshSelectedAccount(successMessage = "User found.") {
    if (!selectedAccount?.email) return;
    const account = await searchAccount(selectedAccount.email, "Refreshing account…");
    setAdminStatus(successMessage.replace("{credits}", String(account.credits)), "success");
  }

  async function handleSearch(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const email = adminUserEmail.value.trim().toLowerCase();
    selectedAccount = null;
    adminUserResult.hidden = true;
    setBusy(true);
    try {
      await searchAccount(email);
      setAdminStatus("User found.", "success");
    } catch (error) {
      setAdminStatus(error.message || "That user could not be found.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function changeCredits(mode) {
    if (!selectedAccount) return;
    const amount = Number(adminCreditAmount.value);
    if (mode !== "reset" && (adminCreditAmount.value.trim() === "" || !Number.isInteger(amount))) {
      setAdminStatus("Enter a whole credit amount first.", "error");
      return;
    }
    if (mode === "add" && (amount < 1 || amount > 100000)) {
      setAdminStatus("Enter a whole number between 1 and 100,000 to add.", "error");
      return;
    }
    if (mode === "set" && (amount < 0 || amount > 100000)) {
      setAdminStatus("Enter an exact balance between 0 and 100,000.", "error");
      return;
    }
    if (mode === "reset" && !window.confirm(`Reset ${selectedAccount.email}'s credit balance to 0?`)) return;

    setBusy(true);
    try {
      if (mode === "add") {
        await postAdmin("/api/grant-credits", { email: selectedAccount.email, amount });
        await refreshSelectedAccount(`${amount} credits added. New balance: {credits}.`);
      } else {
        const nextAmount = mode === "reset" ? 0 : amount;
        await postAdmin("/api/admin/set-credits", { email: selectedAccount.email, amount: nextAmount });
        await refreshSelectedAccount(`Credit balance updated to {credits}.`);
      }
      adminCreditAmount.value = "";
    } catch (error) {
      setAdminStatus(error.message || "The credit balance could not be changed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBan(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!selectedAccount || selectedAccount.isAdmin) return;
    const nextBanned = !selectedAccount.banned;
    const verb = nextBanned ? "ban" : "unban";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${selectedAccount.email}?`)) return;

    setBusy(true);
    setAdminStatus(nextBanned ? "Banning account and revoking sessions…" : "Restoring account access…");
    try {
      await rpc("admin_set_user_ban", {
        p_target_email: selectedAccount.email,
        p_banned: nextBanned,
      });
      await searchAccount(selectedAccount.email, "Refreshing account access…");
      setAdminStatus(nextBanned ? "Account banned and active sessions revoked." : "Account access restored.", "success");
      await loadDashboard();
    } catch (error) {
      setAdminStatus(error.message || "Account access could not be changed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendDirectNotification() {
    if (!selectedAccount) return;
    const title = adminDirectNotificationTitle.value.trim();
    const message = adminDirectNotificationMessage.value.trim();
    if (!title || title.length > 80) {
      setDirectStatus("Enter a title between 1 and 80 characters.", "error");
      return;
    }
    if (!message || message.length > 240) {
      setDirectStatus("Enter a message between 1 and 240 characters.", "error");
      return;
    }
    if (!window.confirm(`Send this notification to ${selectedAccount.email}?`)) return;

    adminDirectNotificationButton.disabled = true;
    setDirectStatus("Sending notification…");
    try {
      const result = await postAdmin("/api/admin/send-notification", {
        email: selectedAccount.email,
        title,
        message,
      });
      adminDirectNotificationMessage.value = "";
      setDirectStatus(`Notification processed for ${Number(result.sent) || 0} device(s).`, "success");
    } catch (error) {
      setDirectStatus(error.message || "The notification could not be sent.", "error");
    } finally {
      adminDirectNotificationButton.disabled = false;
    }
  }

  function renderDashboard(data) {
    const stats = data?.stats || {};
    const total = Number(stats.totalUsers) || 0;
    const bannedCount = Number(stats.bannedUsers) || 0;
    const metrics = {
      adminTotalUsers: total,
      adminActiveUsers: Math.max(0, total - bannedCount),
      adminBannedUsers: bannedCount,
      adminSearchesToday: Number(stats.searchesToday) || 0,
      adminCreditsTotal: Number(stats.creditsInCirculation) || 0,
    };
    Object.entries(metrics).forEach(([id, value]) => {
      const node = byId(id);
      if (node) node.textContent = String(value);
    });

    const signups = Array.isArray(data?.recentSignups) ? data.recentSignups : [];
    recentSignupsList.innerHTML = signups.length
      ? signups.map((item) => `
        <button class="admin-activity-row" type="button" data-account-email="${escapeHtml(item.email)}">
          <span class="activity-primary">${emailMarkup(item.email, Boolean(item.owner))}</span>
          <span class="activity-meta">${item.banned ? "Banned" : item.confirmed ? "Verified" : "Unconfirmed"} · ${escapeHtml(formatDateTime(item.created_at))}</span>
        </button>`).join("")
      : '<p class="notification-empty">No signups yet.</p>';

    const searches = Array.isArray(data?.recentSearches) ? data.recentSearches : [];
    recentSearchesList.innerHTML = searches.length
      ? searches.map((item) => `
        <button class="admin-activity-row" type="button" data-account-email="${escapeHtml(item.email)}">
          <span class="activity-primary"><strong>${escapeHtml(item.registration)}</strong><small>${escapeHtml(item.email)}</small></span>
          <span class="activity-meta">${escapeHtml(item.status)} · ${escapeHtml(formatDateTime(item.created_at))}</span>
        </button>`).join("")
      : '<p class="notification-empty">No vehicle searches yet.</p>';

    const banned = Array.isArray(data?.bannedUsers) ? data.bannedUsers : [];
    bannedUsersList.innerHTML = banned.length
      ? banned.map((item) => `
        <button class="admin-activity-row is-banned" type="button" data-account-email="${escapeHtml(item.email)}">
          <span class="activity-primary">${escapeHtml(item.email)}</span>
          <span class="activity-meta">Access blocked</span>
        </button>`).join("")
      : '<p class="notification-empty">No banned accounts.</p>';
  }

  async function loadDashboard() {
    if (adminDashboardRefreshButton) adminDashboardRefreshButton.disabled = true;
    try {
      renderDashboard(await rpc("admin_get_dashboard"));
    } catch (error) {
      [recentSignupsList, recentSearchesList, bannedUsersList].forEach((list) => {
        if (list) list.innerHTML = `<p class="notification-empty">${escapeHtml(error.message || "Dashboard data could not be loaded.")}</p>`;
      });
    } finally {
      if (adminDashboardRefreshButton) adminDashboardRefreshButton.disabled = false;
    }
  }

  function renderBroadcastHistory(items) {
    broadcastHistoryList.innerHTML = items.length
      ? items.map((item) => `
        <article class="broadcast-history-item" data-broadcast-id="${escapeHtml(item.id)}">
          <div><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDateTime(item.created_at))}</time></div>
          <p>${escapeHtml(item.message)}</p>
          <div class="broadcast-history-footer">
            <small>${Number(item.recipients) || 0} recipients · ${Number(item.devices) || 0} devices · ${Number(item.sent) || 0} sent · ${Number(item.failed) || 0} failed</small>
            <button class="history-delete-button" type="button" data-delete-broadcast="${escapeHtml(item.id)}">Delete</button>
          </div>
        </article>`).join("")
      : '<p class="notification-empty">No broadcasts yet.</p>';
  }

  async function loadBroadcastHistory() {
    refreshBroadcastHistoryButton.disabled = true;
    try {
      const response = await window.biismoAuth.authorizedFetch("/api/admin/broadcast-history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Broadcast history could not be loaded.");
      renderBroadcastHistory(Array.isArray(data.broadcasts) ? data.broadcasts : []);
    } catch (error) {
      broadcastHistoryList.innerHTML = `<p class="notification-empty">${escapeHtml(error.message || "Broadcast history could not be loaded.")}</p>`;
    } finally {
      refreshBroadcastHistoryButton.disabled = false;
    }
  }

  async function deleteBroadcast(id) {
    if (!window.confirm("Delete this broadcast from the admin history?")) return;
    try {
      await rpc("admin_delete_broadcast", { p_broadcast_id: id });
      await loadBroadcastHistory();
    } catch (error) {
      window.alert(error.message || "That broadcast could not be deleted.");
    }
  }

  function toggleHistory() {
    const show = adminBroadcastHistoryPanel.hidden;
    adminBroadcastHistoryPanel.hidden = !show;
    adminHistoryToggleButton.setAttribute("aria-expanded", String(show));
    adminHistoryToggleButton.textContent = show ? "Hide broadcast history" : "Show broadcast history";
    if (show) loadBroadcastHistory();
  }

  adminUserSearchForm?.addEventListener("submit", handleSearch, true);
  adminAddCreditsButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    changeCredits("add");
  }, true);
  adminSetCreditsButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    changeCredits("set");
  }, true);
  adminResetCreditsButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    changeCredits("reset");
  }, true);
  adminBanUserButton?.addEventListener("click", toggleBan, true);
  adminDirectNotificationButton?.addEventListener("click", sendDirectNotification);
  adminDashboardRefreshButton?.addEventListener("click", loadDashboard);
  adminHistoryToggleButton?.addEventListener("click", toggleHistory);
  refreshBroadcastHistoryButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    loadBroadcastHistory();
  }, true);
  broadcastHistoryList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-broadcast]");
    if (button) deleteBroadcast(button.dataset.deleteBroadcast);
  });

  [recentSignupsList, recentSearchesList, bannedUsersList].forEach((list) => {
    list?.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-account-email]");
      if (!row) return;
      adminUserEmail.value = row.dataset.accountEmail;
      try {
        await searchAccount(row.dataset.accountEmail);
        setAdminStatus("User loaded from recent activity.", "success");
        window.scrollTo({ top: adminUserSearchForm.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
      } catch (error) {
        setAdminStatus(error.message || "That user could not be loaded.", "error");
      }
    });
  });

  adminMenuButton?.addEventListener("click", loadDashboard);

  const ownerObserver = accountEmail
    ? new MutationObserver(() => decorateCurrentOwner())
    : null;
  ownerObserver?.observe(accountEmail, { childList: true, subtree: true, characterData: true });

  window.biismoAuth.ready.then(() => {
    decorateCurrentOwner();
    window.setTimeout(decorateCurrentOwner, 150);
  });
})();
