(() => {
  // Never redirect this clone into the production BiismoReg origin.
  const CANONICAL_ORIGIN = window.location.origin;
  const LEGACY_HOSTS = new Set();
  const REFERRAL_KEY = "checkareg-referral-code-v1";

  function captureReferralCode() {
    try {
      const raw = new URLSearchParams(window.location.search).get("ref");
      if (!raw) return;
      const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (/^[A-Z0-9]{10}$/.test(code)) localStorage.setItem(REFERRAL_KEY, code);
    } catch {
      // Referral capture is optional and must never interrupt the app.
    }
  }

  captureReferralCode();

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

  async function createReferralClient() {
    if (!window.supabase?.createClient) throw new Error("Referral services are unavailable.");
    const response = await fetch("/api/config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error(config.error || "Referral services are unavailable.");
    }
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  function referralSectionMarkup() {
    return `
      <section id="referralSection" class="credits-section" aria-labelledby="referralTitle">
        <div class="section-heading">
          <div>
            <span class="eyebrow">INVITE &amp; EARN</span>
            <h2 id="referralTitle">Give 2 credits. Get 2 credits.</h2>
          </div>
          <span class="credit-rate">Reward unlocks after their first completed check</span>
        </div>
        <p>Share your personal CHECK A REG link. When a new user joins through it and completes their first vehicle check, you both receive 2 credits.</p>
        <div class="credit-summary">
          <article class="credit-card"><span>Successful referrals</span><strong id="referralSuccessful">—</strong><small id="referralPending">Checking pending invites…</small></article>
          <article class="credit-card"><span>Credits earned</span><strong id="referralCreditsEarned">—</strong><small>2 credits for every successful referral</small></article>
        </div>
        <form id="referralShareForm" class="garage-search">
          <label class="sr-only" for="referralLink">Your referral link</label>
          <input id="referralLink" type="text" readonly value="Loading your invite link…" aria-label="Your referral link">
          <button id="referralShareButton" class="primary-button" type="submit" disabled>Share invite</button>
        </form>
        <p id="referralStatus" class="garage-status" role="status"></p>
      </section>`;
  }

  function insertReferralSection() {
    if (document.getElementById("referralSection")) return;
    const creditsSection = document.querySelector("#garageView .credits-section");
    if (!creditsSection) return;
    creditsSection.insertAdjacentHTML("afterend", referralSectionMarkup());
  }

  async function initializeReferralFeature() {
    if (window.location.pathname !== "/account.html") return;

    try {
      await window.biismoAuth?.ready;
      if (!window.biismoAuth?.getUser?.()) return;

      insertReferralSection();
      const status = document.getElementById("referralStatus");
      const shareButton = document.getElementById("referralShareButton");
      const linkInput = document.getElementById("referralLink");
      const successful = document.getElementById("referralSuccessful");
      const pending = document.getElementById("referralPending");
      const earned = document.getElementById("referralCreditsEarned");

      const referralClient = await createReferralClient();
      const { data: sessionData, error: sessionError } = await referralClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.access_token) return;

      let pendingCode = null;
      try {
        pendingCode = localStorage.getItem(REFERRAL_KEY);
      } catch {
        pendingCode = null;
      }

      if (pendingCode) {
        const { data: claim, error: claimError } = await referralClient.rpc("claim_referral", {
          p_code: pendingCode,
        });
        if (claimError) throw claimError;

        try {
          localStorage.removeItem(REFERRAL_KEY);
        } catch {
          // The referral can still function when storage cleanup is unavailable.
        }

        if (claim?.accepted && !claim?.rewarded) {
          status.textContent = "Referral linked. Complete your first vehicle check and you’ll both receive 2 credits.";
        }
      }

      const { data: summary, error: summaryError } = await referralClient.rpc("get_referral_summary");
      if (summaryError) throw summaryError;

      const code = String(summary?.code || "");
      const inviteUrl = `${CANONICAL_ORIGIN}/?ref=${encodeURIComponent(code)}`;
      linkInput.value = inviteUrl;
      successful.textContent = String(Number(summary?.successfulReferrals) || 0);
      earned.textContent = String(Number(summary?.creditsEarned) || 0);
      const pendingCount = Number(summary?.pendingReferrals) || 0;
      pending.textContent = pendingCount === 1 ? "1 invite waiting for a first check" : `${pendingCount} invites waiting for a first check`;
      shareButton.disabled = !code;

      document.getElementById("referralShareForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const shareData = {
          title: "CHECK A REG",
          text: "Use my CHECK A REG invite link. Complete your first vehicle check and we both get 2 credits.",
          url: inviteUrl,
        };

        try {
          if (navigator.share) {
            await navigator.share(shareData);
            status.textContent = "Invite ready to share.";
          } else {
            await navigator.clipboard.writeText(inviteUrl);
            status.textContent = "Referral link copied to your clipboard.";
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            try {
              await navigator.clipboard.writeText(inviteUrl);
              status.textContent = "Referral link copied to your clipboard.";
            } catch {
              status.textContent = "Press and hold the referral link above to copy it.";
            }
          }
        }
      });
    } catch (error) {
      insertReferralSection();
      const status = document.getElementById("referralStatus");
      if (status) status.textContent = error.message || "Referral details could not be loaded.";
    }
  }

  void initializeReferralFeature();

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
