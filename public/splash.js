(() => {
  const splash = document.getElementById("appSplash");
  if (!splash) return;

  const sessionKey = "biismo-splash-seen-v1";
  let alreadySeen = false;

  try {
    alreadySeen = window.sessionStorage.getItem(sessionKey) === "true";
    if (!alreadySeen) window.sessionStorage.setItem(sessionKey, "true");
  } catch {}

  if (alreadySeen) {
    splash.remove();
    return;
  }

  const startedAt = window.performance.now();
  let dismissing = false;

  const dismiss = () => {
    if (dismissing) return;
    dismissing = true;
    const minimumDisplayTime = 1450;
    const remaining = Math.max(0, minimumDisplayTime - (window.performance.now() - startedAt));
    window.setTimeout(() => {
      splash.classList.add("is-leaving");
      window.setTimeout(() => splash.remove(), 500);
    }, remaining);
  };

  if (document.readyState === "complete") dismiss();
  else window.addEventListener("load", dismiss, { once: true });
  window.setTimeout(dismiss, 3500);
})();

const referralStyles = document.createElement("link");
referralStyles.rel = "stylesheet";
referralStyles.href = "/referral.css";
document.head.append(referralStyles);
import("/referral.js").catch((error) => console.error("Referral module failed to load", error));

const aiEntryStyles = document.createElement("link");
aiEntryStyles.rel = "stylesheet";
aiEntryStyles.href = "/ai-mechanic.css";
document.head.append(aiEntryStyles);
import("/ai-entry.js").catch((error) => console.error("AI entry module failed to load", error));

if (window.location.pathname === "/" || window.location.pathname === "/index.html") {
  const resultStyles = document.createElement("link");
  resultStyles.rel = "stylesheet";
  resultStyles.href = "/result-compact.css";
  document.head.append(resultStyles);
}

if (window.location.pathname === "/account.html") {
  const garageHubStyles = document.createElement("link");
  garageHubStyles.rel = "stylesheet";
  garageHubStyles.href = "/garage-hub.css";
  document.head.append(garageHubStyles);

  const garageFixStyles = document.createElement("link");
  garageFixStyles.rel = "stylesheet";
  garageFixStyles.href = "/garage-hub-fixes.css";
  document.head.append(garageFixStyles);

  // Load staff modules independently so one optional module can never block the rest.
  import("/moderator-controls.js").catch((error) => console.error("Moderator controls failed to load", error));
  import("/staff-user-directory.js").catch((error) => console.error("Staff directory failed to load", error));
  import("/staff-dashboard-organizer.js").catch((error) => console.error("Staff dashboard failed to load", error));
  import("/admin-ai-logs.js").catch((error) => console.error("AI logs failed to load", error));
  import("/plan-entitlement-ui.js").catch((error) => console.error("Plan UI failed to load", error));

  const loadGarageHub = () => import("/garage-hub.js")
    .then(() => import("/garage-hub-fixes.js"))
    .then(() => import("/garage-photo-any.js"))
    .then(() => import("/garage-photo-unrestricted.js"))
    .catch((error) => console.error("Garage modules failed to load", error));

  const loadPhotoDisplay = () => import("/garage-photo-display-fix.js").catch((error) => console.error("Garage photo display failed to load", error));

  if (document.readyState === "complete") {
    loadGarageHub();
    loadPhotoDisplay();
  } else {
    window.addEventListener("load", loadGarageHub, { once: true });
    window.addEventListener("load", loadPhotoDisplay, { once: true });
  }
}
