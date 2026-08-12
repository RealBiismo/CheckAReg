(() => {
  if (window.location.pathname !== '/account.html') return;

  const byId = (id) => document.getElementById(id);
  const makeHidden = (id, tag = 'span') => {
    let node = byId(id);
    if (node) return node;
    node = document.createElement(tag);
    node.id = id;
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    document.body.append(node);
    return node;
  };

  const aliases = {
    adminMetricTotalUsers: makeHidden('adminMetricTotalUsers'),
    adminMetricVerifiedUsers: makeHidden('adminMetricVerifiedUsers'),
    adminMetricBannedUsers: makeHidden('adminMetricBannedUsers'),
    adminMetricSearchesToday: makeHidden('adminMetricSearchesToday'),
    adminMetricPushSubscribers: makeHidden('adminMetricPushSubscribers'),
    adminStatus: makeHidden('adminStatus', 'p'),
    selectedUserFreeRemaining: makeHidden('selectedUserFreeRemaining'),
    selectedUserFreeUsed: makeHidden('selectedUserFreeUsed'),
    selectedUserPushDevices: makeHidden('selectedUserPushDevices'),
    adminAccountStatusBadge: makeHidden('adminAccountStatusBadge'),
    adminDashboardRefreshButton: makeHidden('adminDashboardRefreshButton', 'button'),
    adminUserSearchButton: makeHidden('adminUserSearchButton', 'button'),
  };

  const syncDashboard = () => {
    const total = Number(aliases.adminMetricTotalUsers.textContent) || 0;
    const banned = Number(aliases.adminMetricBannedUsers.textContent) || 0;
    const searches = Number(aliases.adminMetricSearchesToday.textContent) || 0;
    const totalEl = byId('adminTotalUsers');
    const activeEl = byId('adminActiveUsers');
    const bannedEl = byId('adminBannedUsers');
    const searchesEl = byId('adminSearchesToday');
    if (totalEl) totalEl.textContent = String(total);
    if (activeEl) activeEl.textContent = String(Math.max(0, total - banned));
    if (bannedEl) bannedEl.textContent = String(banned);
    if (searchesEl) searchesEl.textContent = String(searches);
  };

  ['adminMetricTotalUsers','adminMetricBannedUsers','adminMetricSearchesToday'].forEach((id) => {
    new MutationObserver(syncDashboard).observe(aliases[id], { childList: true, characterData: true, subtree: true });
  });

  const syncUserStatus = () => {
    const visible = byId('adminUserStatus');
    if (!visible) return;
    visible.textContent = aliases.adminStatus.textContent;
    visible.className = aliases.adminStatus.className || 'admin-status';
  };
  new MutationObserver(syncUserStatus).observe(aliases.adminStatus, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  const syncAccountBadge = () => {
    const visible = byId('selectedUserAccountStatus');
    if (!visible) return;
    visible.textContent = aliases.adminAccountStatusBadge.textContent || 'Active';
    visible.className = aliases.adminAccountStatusBadge.className || 'account-status-badge';
  };
  new MutationObserver(syncAccountBadge).observe(aliases.adminAccountStatusBadge, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  async function refreshCreditsMetric() {
    try {
      await window.biismoAuth.ready;
      const client = window.biismoAuth.getClient();
      const { data, error } = await client.rpc('admin_get_dashboard');
      if (error) throw error;
      const stats = data?.stats || {};
      const creditsEl = byId('adminCreditsTotal');
      if (creditsEl) creditsEl.textContent = String(Number(stats.creditsInCirculation) || 0);
      if (byId('adminTotalUsers')) byId('adminTotalUsers').textContent = String(Number(stats.totalUsers) || 0);
      if (byId('adminBannedUsers')) byId('adminBannedUsers').textContent = String(Number(stats.bannedUsers) || 0);
      if (byId('adminSearchesToday')) byId('adminSearchesToday').textContent = String(Number(stats.searchesToday) || 0);
      if (byId('adminActiveUsers')) byId('adminActiveUsers').textContent = String(Math.max(0, (Number(stats.totalUsers) || 0) - (Number(stats.bannedUsers) || 0)));
    } catch (error) {
      console.warn('Admin dashboard compatibility refresh failed:', error);
    }
  }

  const visibleRefresh = byId('adminRefreshButton');
  visibleRefresh?.addEventListener('click', () => {
    aliases.adminDashboardRefreshButton.click();
    void refreshCreditsMetric();
  });

  byId('adminMenuButton')?.addEventListener('click', () => void refreshCreditsMetric());
  void refreshCreditsMetric();
  syncDashboard();
  syncUserStatus();
  syncAccountBadge();
})();
