(() => {
  function addEntry() {
    if (document.querySelector('[data-ai-mechanic-entry]')) return;
    const path = window.location.pathname;

    if (path === "/" || path === "/index.html") {
      const accountButton = document.getElementById("accountButton");
      const actions = accountButton?.parentElement;
      if (!actions) return;
      const link = document.createElement("a");
      link.href = "/ai-mechanic.html";
      link.className = "header-action ai-mechanic-entry";
      link.dataset.aiMechanicEntry = "true";
      link.innerHTML = '<span aria-hidden="true">✦</span> AI Mechanic';
      actions.insertBefore(link, accountButton);
      return;
    }

    if (path === "/account.html") {
      const actions = document.querySelector(".account-header-actions");
      if (!actions) return;
      const link = document.createElement("a");
      link.href = "/ai-mechanic.html";
      link.className = "header-action ai-mechanic-entry";
      link.dataset.aiMechanicEntry = "true";
      link.innerHTML = '<span aria-hidden="true">✦</span> AI Mechanic';
      actions.insertBefore(link, actions.firstChild);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addEntry, { once: true });
  else addEntry();
})();