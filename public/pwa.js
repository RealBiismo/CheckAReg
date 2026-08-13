(() => {
  // Never redirect this app into the previous production origin.
  const CANONICAL_ORIGIN = window.location.origin;
  const LEGACY_HOSTS = new Set();
  if (LEGACY_HOSTS.has(window.location.hostname)) {
    void (async () => {
      let hadPushSubscription = false;

      try {
        const registration = await navigator.serviceWorker?.getRegistration("/");
        const subscription = await registration?.pushManager?.getSubscription();

        if (subscription) {
          hadPushSubscription = true;

          try {
            await window.biismoAuth?.ready;
            if (window.biismoAuth?.getUser?.()) {
              await window.biismoAuth.authorizedFetch("/api/push/subscribe", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: subscription.endpoint }),
              });
            }
          } catch {
            // Unsubscribing in the browser still invalidates the old endpoint.
          }

          try {
            await subscription.unsubscribe();
          } catch {
            // Continue to the canonical domain even if cleanup is incomplete.
          }
        }

        const registrations = await navigator.serviceWorker?.getRegistrations?.();
        await Promise.all((registrations || []).map((registration) => registration.unregister()));
      } catch {
        // The canonical-domain redirect must not depend on service-worker support.
      }

      const destination = new URL(window.location.href);
      destination.protocol = "https:";
      destination.host = new URL(CANONICAL_ORIGIN).host;

      if (hadPushSubscription) {
        destination.pathname = "/account.html";
        destination.search = "?pushMigration=1";
        destination.hash = "";
      }

      window.location.replace(destination.href);
    })();
    return;
  }

  const DISMISS_KEY = "biismo-install-dismissed-until";
  const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;
  let deferredInstallPrompt = null;
  let promptElement = null;

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const userAgent = window.navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isIOSSafari =
    isIOS && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);

  function registrationIsDismissed() {
    try {
      return Number.parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10) > Date.now();
    } catch {
      return false;
    }
  }

  function rememberDismissal() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_FOR_MS));
    } catch {
      // The prompt can still be dismissed when storage is unavailable.
    }
  }

  function hidePrompt(remember = false) {
    if (!promptElement) return;
    if (remember) rememberDismissal();
    promptElement.classList.remove("is-visible");
    const elementToRemove = promptElement;
    promptElement = null;
    window.setTimeout(() => elementToRemove.remove(), 340);
  }

  function showPrompt(mode) {
    if (promptElement || isStandalone || registrationIsDismissed()) return;

    const isAppleInstructions = mode === "ios";
    const prompt = document.createElement("aside");
    prompt.className = "install-prompt";
    prompt.setAttribute("role", "region");
    prompt.setAttribute("aria-label", "Install CHECK A REG app");
    prompt.innerHTML = `
      <img class="install-prompt__icon" src="/icon-192.png" alt="">
      <div class="install-prompt__copy">
        <strong>Add CHECK A REG to your Home Screen</strong>
        <span>${
          isAppleInstructions
            ? "Use CHECK A REG like an app on your iPhone or iPad."
            : "Install the vehicle checker for quick access."
        }</span>
      </div>
      <button class="install-prompt__close" type="button" aria-label="Dismiss install suggestion">×</button>
      <div class="install-prompt__actions">
        <button class="install-prompt__install" type="button">${
          isAppleInstructions ? "How to add" : "Add app"
        }</button>
      </div>
    `;

    document.body.append(prompt);
    promptElement = prompt;
    window.requestAnimationFrame(() => prompt.classList.add("is-visible"));

    prompt.querySelector(".install-prompt__close").addEventListener("click", () => {
      hidePrompt(true);
    });

    const installButton = prompt.querySelector(".install-prompt__install");
    installButton.addEventListener("click", async () => {
      if (isAppleInstructions) {
        const copy = prompt.querySelector(".install-prompt__copy span");
        copy.textContent = "Tap Safari’s Share button, then choose ‘Add to Home Screen’.";
        installButton.textContent = "Got it";
        installButton.addEventListener("click", () => hidePrompt(true), { once: true });
        return;
      }

      if (!deferredInstallPrompt) return;
      installButton.disabled = true;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      hidePrompt(choice.outcome === "dismissed");
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showPrompt("native");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hidePrompt(false);
  });

  if (isIOSSafari && !isStandalone && !registrationIsDismissed()) {
    window.setTimeout(() => showPrompt("ios"), 1400);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installation still degrades safely if service worker setup fails.
      });
    });
  }
})();
