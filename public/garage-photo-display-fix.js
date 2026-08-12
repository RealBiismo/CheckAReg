(() => {
  const grid = document.getElementById("savedVehicles");
  if (!grid || !window.biismoAuth) return;

  let client = null;
  const refreshTimers = new WeakMap();

  function registrationFromCard(card) {
    return String(card.dataset.registration || card.querySelector(".mini-plate")?.textContent || "")
      .replace(/^GB/i, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Photo could not be prepared for display."));
      reader.readAsDataURL(blob);
    });
  }

  function setPhoto(card, url) {
    const image = card.querySelector("[data-vehicle-photo]");
    const placeholder = card.querySelector("[data-photo-placeholder]");
    if (!image || !url) return false;

    image.src = url;
    image.hidden = false;
    image.removeAttribute("hidden");
    image.style.display = "block";
    image.style.visibility = "visible";
    image.style.opacity = "1";
    if (placeholder) {
      placeholder.hidden = true;
      placeholder.setAttribute("hidden", "");
      placeholder.style.display = "none";
    }
    return true;
  }

  async function displayPhoto(card, path) {
    if (!path) return false;

    // The site CSP allows data: images, but blocks blob: and direct Supabase
    // image URLs. Download privately with the signed-in session, then convert
    // the Blob to a data URL before assigning it to <img>.
    try {
      const { data, error } = await client.storage.from("vehicle-photos").download(path);
      if (!error && data) {
        const dataUrl = await blobToDataUrl(data);
        return setPhoto(card, dataUrl);
      }
    } catch {}

    return false;
  }

  async function refreshCard(card) {
    const registration = registrationFromCard(card);
    if (!registration || card.classList.contains("is-photo-uploading")) return;

    try {
      const { data, error } = await client
        .from("vehicle_profiles")
        .select("photo_path")
        .eq("registration", registration)
        .maybeSingle();
      if (error || !data?.photo_path) return;
      await displayPhoto(card, data.photo_path);
    } catch {}
  }

  function scheduleRefresh(card, delay = 100) {
    const existing = refreshTimers.get(card);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      refreshTimers.delete(card);
      refreshCard(card);
    }, delay);
    refreshTimers.set(card, timer);
  }

  function decorate(card) {
    if (!card.querySelector("[data-vehicle-photo]")) return;
    if (card.dataset.photoDisplayFixReady !== "true") {
      card.dataset.photoDisplayFixReady = "true";
      [0, 500, 1500, 4000].forEach((delay) => window.setTimeout(() => refreshCard(card), delay));
    }
  }

  async function initialize() {
    await window.biismoAuth.ready;
    client = window.biismoAuth.getClient?.();
    if (!client || !window.biismoAuth.getUser()) return;

    const decorateAll = () => grid.querySelectorAll(".garage-card").forEach(decorate);
    decorateAll();

    const observer = new MutationObserver((mutations) => {
      decorateAll();
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;
        const target = mutation.target;
        if (!(target instanceof HTMLImageElement) || !target.matches("[data-vehicle-photo]")) continue;
        const card = target.closest(".garage-card");
        if (card && (target.hidden || !String(target.src || "").startsWith("data:image/"))) {
          scheduleRefresh(card, 50);
        }
      }
    });
    observer.observe(grid, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "src"],
    });

    grid.addEventListener("change", (event) => {
      const input = event.target.closest?.("[data-photo-input]");
      if (!input) return;
      const card = input.closest(".garage-card");
      if (!card) return;
      [1200, 2500, 5000, 10000].forEach((delay) => window.setTimeout(() => refreshCard(card), delay));
    });
  }

  initialize().catch(() => {});
})();
