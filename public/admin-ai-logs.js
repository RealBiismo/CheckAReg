(() => {
  if (window.location.pathname !== '/account.html') return;

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  let lastEmail = '';
  let loadingEmail = '';

  function isAdminRole() {
    const role = document.body.dataset.staffRole || '';
    return role === 'owner' || role === 'admin';
  }

  function ensurePanel() {
    const result = byId('adminUserResult');
    if (!result || byId('adminAiLogsPanel')) return byId('adminAiLogsPanel');

    const panel = document.createElement('section');
    panel.id = 'adminAiLogsPanel';
    panel.className = 'admin-ai-logs-panel';
    panel.innerHTML = `
      <div class="admin-ai-logs-heading">
        <div>
          <span class="eyebrow">CHECK A REG AI AUDIT</span>
          <h3>AI Logs</h3>
          <small>Includes chats removed from the user's own history.</small>
        </div>
        <span id="adminAiLogsCount" class="admin-ai-log-count">—</span>
      </div>
      <p id="adminAiLogsStatus" class="admin-status" role="status"></p>
      <div id="adminAiLogsList" class="admin-ai-logs-list"><p class="notification-empty">Select a user to load AI logs.</p></div>`;
    result.append(panel);
    return panel;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function renderLogs(data) {
    const list = byId('adminAiLogsList');
    const count = byId('adminAiLogsCount');
    if (!list) return;
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    if (count) count.textContent = `${logs.length} chat${logs.length === 1 ? '' : 's'}`;
    list.innerHTML = logs.length ? logs.map((log) => {
      const messages = Array.isArray(log.messages) ? log.messages : [];
      return `
        <details class="admin-ai-log${log.deletedByUser ? ' is-deleted' : ''}">
          <summary>
            <span class="admin-ai-log-main">
              <strong>${escapeHtml(log.registration || 'Vehicle')}</strong>
              <span>${escapeHtml(log.title || log.category || 'Check A Reg AI chat')}</span>
            </span>
            <span class="admin-ai-log-meta">
              ${log.deletedByUser ? '<b>User deleted</b>' : '<b>Visible</b>'}
              <small>${escapeHtml(formatDate(log.createdAt))}</small>
            </span>
          </summary>
          <div class="admin-ai-log-body">
            ${log.deletedByUser ? `<p class="admin-ai-deleted-note">Removed from the user's history ${log.deletedAt ? `on ${escapeHtml(formatDate(log.deletedAt))}` : ''}. Audit copy retained.</p>` : ''}
            <div class="admin-ai-message-list">
              ${messages.length ? messages.map((message) => `
                <article class="admin-ai-message ${message.role === 'user' ? 'is-user' : 'is-ai'}">
                  <header><strong>${message.role === 'user' ? 'User' : 'Check A Reg AI'}</strong><time>${escapeHtml(formatDate(message.createdAt))}</time></header>
                  <p>${escapeHtml(message.content)}</p>
                  ${Number(message.imageCount) > 0 ? `<small>${Number(message.imageCount)} image attachment${Number(message.imageCount) === 1 ? '' : 's'}</small>` : ''}
                </article>`).join('') : '<p class="notification-empty">No stored messages.</p>'}
            </div>
          </div>
        </details>`;
    }).join('') : '<p class="notification-empty">No Check A Reg AI chats for this account yet.</p>';
  }

  async function loadLogs(email) {
    if (!email || !isAdminRole() || loadingEmail === email) return;
    ensurePanel();
    loadingEmail = email;
    lastEmail = email;
    const status = byId('adminAiLogsStatus');
    const list = byId('adminAiLogsList');
    if (status) status.textContent = 'Loading Check A Reg AI logs…';
    if (list) list.innerHTML = '<p class="notification-empty">Loading AI logs…</p>';
    try {
      await window.biismoAuth.ready;
      const client = window.biismoAuth.getClient();
      const { data, error } = await client.rpc('admin_get_ai_logs', { p_target_email: email, p_limit: 100 });
      if (error) throw new Error(error.message || 'AI logs could not be loaded.');
      if (lastEmail !== email) return;
      renderLogs(data);
      if (status) status.textContent = '';
    } catch (error) {
      if (list) list.innerHTML = '<p class="notification-empty">AI logs unavailable.</p>';
      if (status) status.textContent = error.message || 'AI logs could not be loaded.';
    } finally {
      if (loadingEmail === email) loadingEmail = '';
    }
  }

  function selectedEmail() {
    return String(byId('selectedUserEmail')?.textContent || '').replace('♛','').trim().toLowerCase();
  }

  function onSelectedUserChanged() {
    if (!isAdminRole()) return;
    const email = selectedEmail();
    if (!email.includes('@')) return;
    ensurePanel();
    void loadLogs(email);
  }

  async function init() {
    await window.biismoAuth?.ready;
    const waitForRole = () => new Promise((resolve) => {
      if (document.body.dataset.staffRole) return resolve();
      const observer = new MutationObserver(() => {
        if (!document.body.dataset.staffRole) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(document.body, { attributes:true, attributeFilter:['data-staff-role'] });
      setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
    });
    await waitForRole();
    if (!isAdminRole()) return;

    if (!document.querySelector('link[href="/admin-ai-logs.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/admin-ai-logs.css';
      document.head.append(link);
    }

    ensurePanel();
    const node = byId('selectedUserEmail');
    if (node) new MutationObserver(onSelectedUserChanged).observe(node, { childList:true, subtree:true, characterData:true });
    onSelectedUserChanged();

  }

  void init();
})();
