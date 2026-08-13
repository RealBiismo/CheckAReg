(() => {
  const REFERRAL_KEY = "biismo-referral-code-v1";
  const STATUS_KEY = "biismo-referral-status-v1";

  function normaliseCode(value) {
    const code = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^[A-Z0-9]{10}$/.test(code) ? code : null;
  }

  function readPendingCode() {
    try { return normaliseCode(localStorage.getItem(REFERRAL_KEY)); } catch { return null; }
  }

  function rememberCode(code) {
    if (!code) return;
    try { localStorage.setItem(REFERRAL_KEY, code); } catch {}
  }

  function forgetCode() {
    try { localStorage.removeItem(REFERRAL_KEY); } catch {}
  }

  function rememberStatus(message) {
    try { sessionStorage.setItem(STATUS_KEY, message); } catch {}
  }

  function takeStatus() {
    try {
      const message = sessionStorage.getItem(STATUS_KEY) || "";
      sessionStorage.removeItem(STATUS_KEY);
      return message;
    } catch { return ""; }
  }

  async function waitForAuth(timeoutMs = 10000) {
    const started = Date.now();
    while (!window.biismoAuth?.ready && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (!window.biismoAuth?.ready) return false;
    await window.biismoAuth.ready;
    return true;
  }

  const queryCode = normaliseCode(new URLSearchParams(window.location.search).get("ref"));
  if (queryCode) rememberCode(queryCode);

  function createInviteBanner(label, rewardCredits = 2) {
    if (document.getElementById("referralInviteBanner")) return;
    const hero = document.querySelector(".hero-shell");
    if (!hero) return;

    const banner = document.createElement("aside");
    banner.id = "referralInviteBanner";
    banner.className = "referral-invite-banner";
    banner.setAttribute("role", "status");

    const copy = document.createElement("div");
    copy.className = "referral-invite-copy";

    const eyebrow = document.createElement("span");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "CHECK A REG INVITE";

    const title = document.createElement("strong");
    title.textContent = `You’ve been referred by ${label}`;

    const text = document.createElement("p");
    text.textContent = `Create your account and complete your first vehicle check to receive ${rewardCredits} free credits. Your referrer gets ${rewardCredits} credits too.`;

    copy.append(eyebrow, title, text);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "primary-button referral-invite-action";
    action.textContent = `Create account +${rewardCredits} credits`;
    action.addEventListener("click", () => window.biismoAuth?.openAuthDialog?.("signup"));

    banner.append(copy, action);
    hero.parentNode.insertBefore(banner, hero);
  }

  function createClaimNotice(message, rewarded = false) {
    if (!message || document.getElementById("referralClaimNotice")) return;
    const garageView = document.getElementById("garageView");
    if (!garageView) return;

    const notice = document.createElement("div");
    notice.id = "referralClaimNotice";
    notice.className = `referral-claim-notice${rewarded ? " is-rewarded" : ""}`;
    notice.setAttribute("role", "status");

    const mark = document.createElement("span");
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = rewarded ? "+2" : "✓";

    const text = document.createElement("strong");
    text.textContent = message;

    notice.append(mark, text);
    garageView.insertBefore(notice, garageView.firstChild);
  }

  async function getInviteInfo(client, code) {
    if (!client || !code) return null;
    try {
      const { data, error } = await client.rpc("get_referral_invite_info", { p_code: code });
      if (error || !data?.valid) return null;
      return data;
    } catch { return null; }
  }

  let claimPromise = null;
  async function claimPendingReferral() {
    if (claimPromise) return claimPromise;
    claimPromise = (async () => {
      if (!(await waitForAuth())) return null;
      const user = window.biismoAuth?.getUser?.();
      const client = window.biismoAuth?.getClient?.();
      const code = readPendingCode();
      if (!user || !client || !code) return null;

      const invite = await getInviteInfo(client, code);
      const label = invite?.referrerLabel || "your referrer";
      const { data: claim, error } = await client.rpc("claim_referral", { p_code: code });
      if (error) throw error;

      if (claim?.accepted) {
        forgetCode();
        const credits = Number(claim.rewardCredits) || 2;
        const message = claim.rewarded
          ? `Referral reward unlocked — ${credits} credits were added to you and ${label}.`
          : `Referral linked to ${label}. Complete your first vehicle check and you’ll both receive ${credits} credits.`;
        rememberStatus(message);
        createClaimNotice(message, Boolean(claim.rewarded));
        window.dispatchEvent(new CustomEvent("biismo-referral-claimed", { detail: claim }));
        return claim;
      }

      const permanentReasons = new Set(["invalid_code", "self_referral", "account_too_old"]);
      if (permanentReasons.has(claim?.reason)) forgetCode();
      return claim;
    })().finally(() => { claimPromise = null; });
    return claimPromise;
  }

  async function initialise() {
    if (!(await waitForAuth())) return;
    const client = window.biismoAuth?.getClient?.();
    const code = readPendingCode();

    if (client && code && (window.location.pathname === "/" || window.location.pathname === "/index.html")) {
      const invite = await getInviteInfo(client, code);
      if (invite?.valid) createInviteBanner(invite.referrerLabel || "a CheckA Reg user", Number(invite.rewardCredits) || 2);
      else if (queryCode) forgetCode();
    }

    const priorStatus = takeStatus();
    if (priorStatus && window.location.pathname === "/account.html") {
      createClaimNotice(priorStatus, priorStatus.toLowerCase().includes("reward unlocked"));
    }

    if (window.biismoAuth?.getUser?.() && code) {
      try { await claimPendingReferral(); } catch {}
    }
  }

  window.addEventListener("biismo-auth-change", () => {
    if (!window.biismoAuth?.getUser?.() || !readPendingCode()) return;
    claimPendingReferral().catch(() => {});
  });

  window.biismoReferral = { getPendingCode: readPendingCode, claimPendingReferral };
  initialise().catch(() => {});
})();
