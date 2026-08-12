(() => {
  async function init() {
    if (window.location.pathname !== '/account.html') return;
    try {
      await window.biismoAuth?.ready;
      if (!window.biismoAuth?.getUser?.()) return;
      const response = await window.biismoAuth.authorizedFetch('/api/plus/status', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;
      const limit = Math.max(3, Number(data.garageLimit) || 3);
      const limitCopy = document.querySelector('.garage-limit');
      if (limitCopy) limitCopy.textContent = data.plusActive ? `Check A Reg+ · up to ${limit} vehicles` : `Maximum ${limit} vehicles per account`;
      const creditsTitle = document.getElementById('creditsTitle');
      if (data.plusActive && creditsTitle && !document.getElementById('plusGarageBadge')) {
        const badge = document.createElement('span');
        badge.id = 'plusGarageBadge';
        badge.className = 'credit-rate';
        badge.textContent = `REG+ · ${Number(data.aiQuestions) || 0} AI questions`;
        creditsTitle.parentElement?.append(badge);
      }
    } catch {
      // Plan decoration is optional and must never block Garage loading.
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
