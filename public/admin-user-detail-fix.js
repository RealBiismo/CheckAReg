(() => {
  if (window.location.pathname !== '/account.html') return;

  const OWNER_EMAIL = 'cybzerohq@gmail.com';
  const byId = (id) => document.getElementById(id);
  let loadingEmail = '';
  let lastLoadedEmail = '';

  function formatJoined(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  function selectedEmail() {
    return String(byId('selectedUserEmail')?.textContent || '')
      .replace('♛', '')
      .trim()
      .toLowerCase();
  }

  function setResetStatus(message, type = '') {
    const status = byId('adminPasswordResetStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `admin-status ${type ? `is-${type}` : ''}`.trim();
  }

  function ensurePasswordResetControl() {
    const result = byId('adminUserResult');
    if (!result || byId('adminSendPasswordResetButton')) return;

    const currentUser = window.biismoAuth?.getUser?.();
    if (String(currentUser?.email || '').toLowerCase() !== OWNER_EMAIL) return;

    const anchor = result.querySelector('.admin-access-controls') || result.querySelector('.admin-credit-controls');
    if (!anchor) return;

    const section = document.createElement('div');
    section.className = 'admin-password-reset-control';
    section.innerHTML = `
      <div>
        <span class="eyebrow">PASSWORD ACCESS</span>
        <p>Send this user a secure link to choose a new password.</p>
      </div>
      <button id="adminSendPasswordResetButton" class="secondary-button" type="button">Send password reset link</button>
      <p id="adminPasswordResetStatus" class="admin-status" role="status"></p>
    `;
    anchor.insertAdjacentElement('afterend', section);

    byId('adminSendPasswordResetButton')?.addEventListener('click', sendPasswordReset);
  }

  async function sendPasswordReset() {
    const email = selectedEmail();
    const button = byId('adminSendPasswordResetButton');
    if (!email.includes('@') || !button) return;

    const currentUser = window.biismoAuth?.getUser?.();
    if (String(currentUser?.email || '').toLowerCase() !== OWNER_EMAIL) {
      setResetStatus('Owner access required.', 'error');
      return;
    }

    if (!window.confirm(`Send a password reset link to ${email}?`)) return;

    button.disabled = true;
    setResetStatus('Sending password reset email…');
    try {
      await window.biismoAuth.ready;
      const client = window.biismoAuth.getClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/?recovery=1`
      });
      if (error) throw error;
      setResetStatus(`Password reset link sent to ${email}.`, 'success');
    } catch (error) {
      setResetStatus(error?.message || 'Password reset email could not be sent.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function render(account) {
    const searches = byId('selectedUserSearches');
    const vehicles = byId('selectedUserVehicles');
    const joined = byId('selectedUserJoined');
    const credits = byId('selectedUserCredits');

    if (credits) credits.textContent = String(Number(account?.credits) || 0);
    if (searches) searches.textContent = String(Number(account?.searchesToday) || 0);
    if (vehicles) vehicles.textContent = String(Number(account?.savedVehicles) || 0);
    if (joined) joined.textContent = formatJoined(account?.joinedAt);
    ensurePasswordResetControl();
    setResetStatus('');
  }

  async function load(email) {
    if (!email.includes('@') || loadingEmail === email) return;
    loadingEmail = email;
    try {
      await window.biismoAuth.ready;
      const response = await window.biismoAuth.authorizedFetch('/api/admin/user-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const account = await response.json();
      if (!response.ok) throw new Error(account?.error || 'User details could not be loaded.');
      if (selectedEmail() !== email) return;
      render(account);
      lastLoadedEmail = email;
    } catch (error) {
      console.error('Selected account metrics failed to load:', error);
    } finally {
      if (loadingEmail === email) loadingEmail = '';
    }
  }

  function sync() {
    const email = selectedEmail();
    if (!email.includes('@')) return;
    ensurePasswordResetControl();
    if (email !== lastLoadedEmail) void load(email);
  }

  function init() {
    const emailNode = byId('selectedUserEmail');
    const result = byId('adminUserResult');
    if (!emailNode || !result) return;

    new MutationObserver(sync).observe(emailNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
    new MutationObserver(sync).observe(result, {
      attributes: true,
      attributeFilter: ['hidden']
    });
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
