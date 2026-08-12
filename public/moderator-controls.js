(() => {
  if (window.location.pathname !== "/account.html") return;

  const byId = (id) => document.getElementById(id);
  const OWNER_EMAIL = "cybzerohq@gmail.com";
  let clientPromise = null;
  let staffRole = "user";
  let lastInsightEmail = "";

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const fmt = (value) => {
    if (!value) return "Not yet";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  };

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        await window.biismoAuth.ready;
        const response = await fetch("/api/config", { cache: "no-store" });
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "Staff tools are unavailable.");
        const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("Sign in again to use staff tools.");
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

  function injectStylesheet() {
    if (document.querySelector('link[href="/moderator-controls.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/moderator-controls.css";
    document.head.append(link);
  }

  function addRoleBanner() {
    const adminView = byId("adminView");
    if (!adminView || byId("staffRoleBanner")) return;
    const banner = document.createElement("div");
    banner.id = "staffRoleBanner";
    banner.className = `staff-role-banner is-${staffRole}`;
    banner.innerHTML = staffRole === "moderator"
      ? '<strong>Moderator access</strong><span>Read-only support access. You can inspect accounts, searches and credits, add support notes and flag accounts for admin review.</span>'
      : staffRole === "owner"
        ? '<strong>Owner access</strong><span>Full CHECK A REG control, including team management.</span>'
        : '<strong>Admin access</strong><span>Operational controls for users, credits, bans and notifications.</span>';
    adminView.prepend(banner);
  }

  function applyModeratorRestrictions() {
    if (staffRole !== "moderator") return;
    document.body.classList.add("is-moderator");
    const menuButton = byId("adminMenuButton");
    if (menuButton) menuButton.textContent = "Moderator";
    [
      ".admin-credit-controls",
      ".admin-access-controls",
      ".admin-direct-notification",
      ".admin-broadcast-panel",
      ".admin-history-panel",
    ].forEach((selector) => document.querySelectorAll(selector).forEach((node) => { node.hidden = true; }));
  }

  function ensureInsightPanel() {
    const result = byId("adminUserResult");
    if (!result || byId("staffAccountInsights")) return;
    const panel = document.createElement("section");
    panel.id = "staffAccountInsights";
    panel.className = "staff-account-insights";
    panel.innerHTML = `
      <div class="staff-insight-grid">
        <article><span>Total searches</span><strong id="staffTotalSearches">—</strong></article>
        <article><span>Last search</span><strong id="staffLastSearch">—</strong></article>
        <article><span>Saved vehicles</span><strong id="staffSavedVehicles">—</strong></article>
        <article><span>Joined</span><strong id="staffJoinedAt">—</strong></article>
        <article><span>Email verified</span><strong id="staffVerified">—</strong></article>
        <article><span>Account role</span><strong id="staffTargetRole">User</strong></article>
      </div>
      <div class="staff-notes-panel">
        <div><span class="eyebrow">SUPPORT NOTES</span><h3>Internal account notes</h3></div>
        <textarea id="staffSupportNote" maxlength="500" rows="3" placeholder="Add an internal note for staff…"></textarea>
        <div class="staff-note-actions">
          <button id="staffAddNoteButton" class="secondary-button" type="button">Add note</button>
          <button id="staffFlagButton" class="secondary-button staff-flag-button" type="button">Flag for admin</button>
        </div>
        <p id="staffNoteStatus" class="admin-status" role="status"></p>
        <div id="staffNotesList" class="staff-notes-list"><p class="notification-empty">No support notes yet.</p></div>
      </div>`;
    result.append(panel);
    byId("staffAddNoteButton")?.addEventListener("click", () => saveNote(false));
    byId("staffFlagButton")?.addEventListener("click", () => saveNote(true));
  }

  async function loadNotes(email) {
    const list = byId("staffNotesList");
    if (!list || !email) return;
    try {
      const items = await rpc("staff_get_support_notes", { p_target_email: email });
      list.innerHTML = Array.isArray(items) && items.length
        ? items.map((item) => `<article class="staff-note ${item.flagged ? "is-flagged" : ""}">
            <div><strong>${item.flagged ? "⚑ Flagged" : "Support note"}</strong><time>${escapeHtml(fmt(item.created_at))}</time></div>
            <p>${escapeHtml(item.note)}</p><small>By ${escapeHtml(item.staff_email)}</small>
          </article>`).join("")
        : '<p class="notification-empty">No support notes yet.</p>';
    } catch (error) {
      list.innerHTML = `<p class="notification-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  async function saveNote(flagged) {
    const email = String(byId("selectedUserEmail")?.textContent || "").replace("♛", "").trim().toLowerCase();
    const input = byId("staffSupportNote");
    const status = byId("staffNoteStatus");
    let note = input?.value.trim() || "";
    if (flagged && !note) note = "Flagged for admin review.";
    if (!email || !note) {
      if (status) status.textContent = "Add a support note first.";
      return;
    }
    try {
      if (status) status.textContent = flagged ? "Flagging account…" : "Saving note…";
      await rpc("staff_add_support_note", { p_target_email: email, p_note: note, p_flag: flagged });
      if (input) input.value = "";
      if (status) status.textContent = flagged ? "Account flagged for admin review." : "Support note saved.";
      await loadNotes(email);
    } catch (error) {
      if (status) status.textContent = error.message || "Note could not be saved.";
    }
  }

  async function loadAccountInsights(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized || normalized === lastInsightEmail) return;
    lastInsightEmail = normalized;
    ensureInsightPanel();
    try {
      const account = await rpc("admin_get_user_credits", { p_target_email: normalized });
      byId("staffTotalSearches").textContent = String(Number(account.totalSearches) || 0);
      byId("staffLastSearch").textContent = fmt(account.lastSearchAt);
      byId("staffSavedVehicles").textContent = `${Number(account.savedVehicles) || 0} / 3`;
      byId("staffJoinedAt").textContent = fmt(account.joinedAt);
      byId("staffVerified").textContent = account.verified ? "Yes" : "No";
      const targetRole = account.isOwner ? "Owner" : account.isAdmin ? "Admin" : account.isModerator ? "Moderator" : "User";
      byId("staffTargetRole").textContent = targetRole;
      const ban = byId("adminBanUserButton");
      if (ban && account.isModerator) {
        ban.disabled = true;
        ban.textContent = "Staff account protected";
      }
      await loadNotes(normalized);
    } catch (error) {
      byId("staffTotalSearches").textContent = "—";
    }
  }

  function watchSelectedAccount() {
    const emailNode = byId("selectedUserEmail");
    if (!emailNode) return;
    const observer = new MutationObserver(() => {
      const email = String(emailNode.textContent || "").replace("♛", "").trim();
      if (email.includes("@")) {
        lastInsightEmail = "";
        void loadAccountInsights(email);
      }
    });
    observer.observe(emailNode, { childList: true, subtree: true, characterData: true });
  }

  function addTeamManagement() {
    if (staffRole !== "owner" || byId("teamManagementPanel")) return;
    const adminView = byId("adminView");
    if (!adminView) return;
    const panel = document.createElement("section");
    panel.id = "teamManagementPanel";
    panel.className = "admin-panel team-management-panel";
    panel.innerHTML = `
      <div class="admin-panel-heading"><div><span class="eyebrow">TEAM MANAGEMENT</span><h2>Moderators</h2></div></div>
      <p>Add verified CHECK A REG accounts as moderators. Moderators can inspect account credits and searches, add support notes and flag accounts, but cannot change credits, bans or notifications.</p>
      <form id="moderatorEmailForm" class="team-management-form">
        <input id="moderatorEmailInput" type="email" placeholder="moderator@example.com" autocomplete="off" required>
        <button class="primary-button" type="submit">Add moderator</button>
      </form>
      <p id="teamManagementStatus" class="admin-status" role="status"></p>
      <div id="staffTeamList" class="staff-team-list"><p class="notification-empty">Loading staff…</p></div>`;
    adminView.append(panel);
    byId("moderatorEmailForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = byId("moderatorEmailInput").value.trim().toLowerCase();
      const status = byId("teamManagementStatus");
      try {
        status.textContent = "Adding moderator…";
        await rpc("owner_set_moderator", { p_target_email: email, p_enabled: true });
        byId("moderatorEmailInput").value = "";
        status.textContent = `${email} is now a moderator.`;
        await loadTeam();
      } catch (error) {
        status.textContent = error.message || "Moderator could not be added.";
      }
    });
    void loadTeam();
  }

  async function loadTeam() {
    const list = byId("staffTeamList");
    if (!list) return;
    try {
      const data = await rpc("owner_list_staff");
      const staff = Array.isArray(data?.staff) ? data.staff : [];
      list.innerHTML = `<article class="staff-team-row is-owner"><div><strong>${OWNER_EMAIL} ♛</strong><span>Owner</span></div></article>` +
        (staff.length ? staff.map((item) => `<article class="staff-team-row"><div><strong>${escapeHtml(item.email)}</strong><span>${escapeHtml(item.role)}</span></div>${item.role === "moderator" ? `<button class="danger-button compact-button" type="button" data-remove-moderator="${escapeHtml(item.email)}">Remove</button>` : ""}</article>`).join("") : "");
      list.querySelectorAll("[data-remove-moderator]").forEach((button) => button.addEventListener("click", async () => {
        const email = button.dataset.removeModerator;
        if (!window.confirm(`Remove moderator access from ${email}?`)) return;
        try {
          await rpc("owner_set_moderator", { p_target_email: email, p_enabled: false });
          byId("teamManagementStatus").textContent = `${email} is no longer a moderator.`;
          await loadTeam();
        } catch (error) {
          byId("teamManagementStatus").textContent = error.message || "Moderator could not be removed.";
        }
      }));
    } catch (error) {
      list.innerHTML = `<p class="notification-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  async function init() {
    injectStylesheet();
    try {
      const role = await rpc("get_staff_role");
      staffRole = String(role?.role || "user");
      if (!role?.hasStaffAccess) return;
      document.body.dataset.staffRole = staffRole;
      addRoleBanner();
      applyModeratorRestrictions();
      ensureInsightPanel();
      watchSelectedAccount();
      addTeamManagement();
    } catch {
      // Normal users simply do not receive staff enhancements.
    }
  }

  void init();
})();
