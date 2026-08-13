(() => {
  if (window.location.pathname !== "/account.html") return;

  const byId = (id) => document.getElementById(id);
  const adminView = byId("adminView");
  if (!adminView) return;
  let activeUserFilter = "all";
  let activeActivity = "signups";

  function injectStyles() {
    if (document.querySelector('link[href="/staff-dashboard-organizer.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/staff-dashboard-organizer.css";
    document.head.append(link);
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

  function hide(node, value = true) {
    if (node) node.hidden = Boolean(value);
  }

  function applyUserFilter() {
    const list = byId("staffUserDirectoryList");
    if (!list) return;
    let visible = 0;
    list.querySelectorAll(".staff-user-row").forEach((row) => {
      const meta = String(row.querySelector(".staff-user-main small")?.textContent || "").toLowerCase();
      const matches = activeUserFilter === "all"
        || (activeUserFilter === "users" && meta.startsWith("user ·"))
        || (activeUserFilter === "moderators" && meta.startsWith("moderator ·"))
        || (activeUserFilter === "banned" && meta.includes("· banned"));
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const count = byId("simpleUserFilterCount");
    if (count) count.textContent = `${visible} shown`;
  }

  function buildUserFilters() {
    const attach = () => {
      const directory = byId("staffUserDirectory");
      if (!directory || byId("simpleUserFilters")) return false;
      const filters = document.createElement("div");
      filters.id = "simpleUserFilters";
      filters.className = "simple-user-filters";
      filters.innerHTML = `
        <div role="group" aria-label="Filter accounts">
          <button type="button" data-user-filter="all" class="is-active">All</button>
          <button type="button" data-user-filter="users">Users</button>
          <button type="button" data-user-filter="moderators">Moderators</button>
          <button type="button" data-user-filter="banned">Banned</button>
        </div>
        <span id="simpleUserFilterCount"></span>`;
      directory.prepend(filters);
      filters.addEventListener("click", (event) => {
        const button = event.target.closest("[data-user-filter]");
        if (!button) return;
        activeUserFilter = button.dataset.userFilter;
        filters.querySelectorAll("[data-user-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
        applyUserFilter();
      });
      const list = byId("staffUserDirectoryList");
      if (list) new MutationObserver(applyUserFilter).observe(list, { childList: true });
      applyUserFilter();
      return true;
    };

    if (attach()) return;
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(adminView, { childList: true, subtree: true });
  }

  function updateActivityPanels() {
    const activity = adminView.querySelector(".admin-quick-tools");
    if (!activity) return;
    const panels = [...activity.querySelectorAll(":scope > .admin-panel")];
    panels.forEach((panel, index) => {
      if (index === 0) panel.hidden = activeActivity !== "signups";
      else if (index === 1) panel.hidden = activeActivity !== "searches";
      else if (index === 2) panel.hidden = activeActivity !== "banned";
      else panel.hidden = true;
    });

    activity.querySelectorAll("[data-simple-activity]").forEach((button) => {
      const active = button.dataset.simpleActivity === activeActivity;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function buildActivitySwitch() {
    const activity = adminView.querySelector(".admin-quick-tools");
    if (!activity || byId("simpleActivitySwitch")) return;
    const toggle = document.createElement("div");
    toggle.id = "simpleActivitySwitch";
    toggle.className = "simple-activity-switch";
    toggle.setAttribute("role", "tablist");
    toggle.setAttribute("aria-label", "Recent activity");
    toggle.innerHTML = `
      <button type="button" role="tab" aria-selected="true" data-simple-activity="signups" class="is-active">Recent signups</button>
      <button type="button" role="tab" aria-selected="false" data-simple-activity="searches">Recent searches</button>
      <button type="button" role="tab" aria-selected="false" data-simple-activity="banned">Banned users</button>`;
    activity.prepend(toggle);
    toggle.addEventListener("click", (event) => {
      const button = event.target.closest("[data-simple-activity]");
      if (!button) return;
      activeActivity = button.dataset.simpleActivity;
      updateActivityPanels();
    });
    updateActivityPanels();
  }

  function buildNav(staffRole) {
    if (byId("simpleStaffNav")) return;
    const nav = document.createElement("nav");
    nav.id = "simpleStaffNav";
    nav.className = "simple-staff-nav";
    nav.setAttribute("aria-label", "Staff menu");

    const items = [["home", "Home"], ["users", "Users"], ["support", "Support"]];
    if (staffRole !== "moderator") items.push(["tools", "Tools"]);

    nav.innerHTML = items.map(([key, label], index) => `
      <button type="button" data-simple-staff-page="${key}" class="${index === 0 ? "is-active" : ""}" aria-current="${index === 0 ? "page" : "false"}">${label}</button>`).join("");

    adminView.prepend(nav);
    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-simple-staff-page]");
      if (!button) return;
      showPage(button.dataset.simpleStaffPage, staffRole);
    });
  }

  function showPage(page, staffRole) {
    const hero = adminView.querySelector(".dashboard-hero");
    const overview = adminView.querySelector(".admin-overview");
    const activity = adminView.querySelector(".admin-quick-tools");
    const dashboardGrid = adminView.querySelector(".admin-dashboard-grid");
    const broadcast = adminView.querySelector(".admin-broadcast-panel");
    const support = byId("adminSupportInbox");
    const history = byId("adminBroadcastHistoryPanel");

    if (page === "tools" && staffRole === "moderator") page = "home";
    adminView.dataset.simpleStaffPage = page;

    hide(hero, page !== "home");
    hide(overview, page !== "home");
    hide(activity, page !== "home");
    hide(dashboardGrid, page !== "users");
    hide(support, page !== "support");
    hide(broadcast, page !== "tools");
    hide(history, page !== "tools");

    if (page === "home") updateActivityPanels();
    if (page === "support") window.checkARegSupport?.loadAdminTickets?.();

    document.querySelectorAll("[data-simple-staff-page]").forEach((button) => {
      const active = button.dataset.simpleStaffPage === page;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function simplify(staffRole) {
    document.body.classList.add("has-simple-staff-dashboard");
    if (staffRole === "moderator") document.body.classList.add("has-moderator-workspace");

    const hero = adminView.querySelector(".dashboard-hero");
    const overview = adminView.querySelector(".admin-overview");
    const dashboardGrid = adminView.querySelector(".admin-dashboard-grid");
    const userPanel = adminView.querySelector(".admin-user-panel");
    const broadcast = adminView.querySelector(".admin-broadcast-panel");
    const support = byId("adminSupportInbox");
    const history = byId("adminBroadcastHistoryPanel");
    const activity = adminView.querySelector(".admin-quick-tools");
    const teamPanel = byId("teamManagementPanel");
    const oldNav = byId("staffWorkspaceNav");
    const banner = byId("staffRoleBanner");
    const globalActions = byId("staffGlobalActions");

    [oldNav, teamPanel, banner, globalActions].forEach((node) => hide(node, true));
    hide(history, true);
    hide(broadcast, true);
    hide(hero, false);
    hide(overview, false);
    hide(activity, false);
    hide(userPanel, false);
    hide(dashboardGrid, true);
    hide(support, true);

    if (dashboardGrid) dashboardGrid.classList.add("is-simple-users-page");
    if (overview && activity && overview.nextElementSibling !== activity) overview.after(activity);
    if (activity && dashboardGrid && activity.nextElementSibling !== dashboardGrid) activity.after(dashboardGrid);
    if (dashboardGrid && support && dashboardGrid.nextElementSibling !== support) dashboardGrid.after(support);
    if (support && broadcast && support.nextElementSibling !== broadcast) support.after(broadcast);
    if (broadcast && history && broadcast.nextElementSibling !== history) broadcast.after(history);

    const menu = byId("adminMenuButton");
    if (menu) menu.textContent = staffRole === "moderator" ? "Moderator" : "Admin";

    buildNav(staffRole);
    buildActivitySwitch();
    buildUserFilters();
    showPage("home", staffRole);
  }

  async function init() {
    injectStyles();
    const staffRole = await waitForRole();
    if (!staffRole || staffRole === "user") return;

    simplify(staffRole);

    const observer = new MutationObserver(() => {
      [byId("teamManagementPanel"), byId("staffRoleBanner"), byId("staffGlobalActions")].forEach((node) => hide(node, true));
      if (adminView.dataset.simpleStaffPage === "home") updateActivityPanels();
    });
    observer.observe(adminView, { childList: true, subtree: true });
  }

  void init();
})();
