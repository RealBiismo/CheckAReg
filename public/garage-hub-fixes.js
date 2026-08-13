(() => {
  const grid = document.getElementById("savedVehicles");
  const originalReminderSection = document.querySelector(".reminder-section");
  const originalReminderToggle = document.getElementById("enableNotificationsButton");
  if (!grid || !window.biismoAuth) return;

  let client = null;
  let user = null;
  let reminderPreferences = new Map();
  let reminderDevicesEnabled = false;

  function registrationFromCard(card) {
    return String(card.dataset.registration || card.querySelector(".mini-plate")?.textContent || "")
      .replace(/^GB/i, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }

  function setHubMessage(card, message, tone = "") {
    const el = card.querySelector("[data-hub-message]");
    if (!el) return;
    el.textContent = message;
    el.className = `ownership-message ${tone ? `is-${tone}` : ""}`.trim();
  }

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
  }

  async function pushSubscriptionExists() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(await registration.pushManager.getSubscription());
    } catch {
      return false;
    }
  }

  async function loadReminderState() {
    reminderDevicesEnabled = await pushSubscriptionExists();
    try {
      const response = await window.biismoAuth.authorizedFetch("/api/reminders/preferences", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reminder preferences could not be loaded.");
      reminderPreferences = new Map((data.vehicles || []).map((vehicle) => [String(vehicle.registration || "").toUpperCase(), {
        vehicleId: vehicle.vehicleId,
        enabled: Boolean(vehicle.enabled),
      }]));
    } catch {
      reminderPreferences = new Map();
    }
  }

  function reminderButtonState(card) {
    const registration = registrationFromCard(card);
    const button = card.querySelector("[data-card-reminder-toggle]");
    const note = card.querySelector("[data-card-reminder-note]");
    if (!button || !note) return;

    const pref = reminderPreferences.get(registration);
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      button.disabled = true;
      button.textContent = "Not supported";
      button.classList.remove("is-active");
      note.textContent = "Push reminders are not supported on this browser.";
      return;
    }
    if (Notification.permission === "denied") {
      button.disabled = true;
      button.textContent = "Blocked";
      button.classList.remove("is-active");
      note.textContent = "Allow notifications in your device settings first.";
      return;
    }
    if (!reminderDevicesEnabled) {
      button.disabled = false;
      button.textContent = "Enable MOT & tax reminders";
      button.classList.remove("is-active");
      note.textContent = "Turns on CheckA Reg notifications for this saved car.";
      return;
    }

    const enabled = Boolean(pref?.enabled);
    button.disabled = !pref?.vehicleId;
    button.textContent = enabled ? "MOT & tax reminders on" : "MOT & tax reminders off";
    button.classList.toggle("is-active", enabled);
    note.textContent = enabled ? "Alerts are scheduled for 30, 14, 7 and 1 day before expiry, plus expiry day." : "Tap to enable alerts for this car.";
  }

  function refreshReminderButtons() {
    grid.querySelectorAll(".garage-card").forEach(reminderButtonState);
  }

  async function setVehicleReminder(card, enabled) {
    const registration = registrationFromCard(card);
    let pref = reminderPreferences.get(registration);
    if (!pref?.vehicleId) {
      await loadReminderState();
      pref = reminderPreferences.get(registration);
    }
    if (!pref?.vehicleId) throw new Error("This saved car is not available in reminder settings yet. Refresh the Garage and try again.");

    const response = await window.biismoAuth.authorizedFetch("/api/reminders/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId: pref.vehicleId, enabled }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Reminder setting could not be saved.");
    reminderPreferences.set(registration, { ...pref, enabled });
  }

  async function enablePushThroughExistingFlow() {
    if (Notification.permission === "denied") throw new Error("Notifications are blocked in your device settings.");
    if (!originalReminderToggle) throw new Error("Reminder controls are unavailable on this device.");

    originalReminderToggle.click();
    const started = Date.now();
    while (Date.now() - started < 20000) {
      if (await pushSubscriptionExists()) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    throw new Error("Notification setup did not finish. Please try again.");
  }

  async function handleReminderClick(card, button) {
    button.disabled = true;
    setHubMessage(card, "Updating reminder settings…");
    try {
      if (!reminderDevicesEnabled) {
        await enablePushThroughExistingFlow();
        reminderDevicesEnabled = true;
        await loadReminderState();
        await setVehicleReminder(card, true);
        setHubMessage(card, "MOT & tax reminders enabled for this car.", "success");
      } else {
        const registration = registrationFromCard(card);
        const current = Boolean(reminderPreferences.get(registration)?.enabled);
        await setVehicleReminder(card, !current);
        setHubMessage(card, !current ? "MOT & tax reminders enabled for this car." : "MOT & tax reminders turned off for this car.", "success");
      }
      refreshReminderButtons();
    } catch (error) {
      setHubMessage(card, error.message || "Reminder settings could not be changed.", "error");
      await loadReminderState();
      refreshReminderButtons();
    } finally {
      button.disabled = false;
      reminderButtonState(card);
    }
  }

  async function decodeImage(file) {
    if ("createImageBitmap" in window) {
      try { return await createImageBitmap(file); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("This photo format could not be opened. Try a JPG or PNG."));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function normalisePhoto(file) {
    if (!String(file.type || "").startsWith("image/")) throw new Error("Choose an image from your photo library.");
    const alreadySupported = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (alreadySupported && file.size <= 4.5 * 1024 * 1024) return file;

    const image = await withTimeout(decodeImage(file), 12000, "The photo took too long to open. Try a smaller image.");
    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("The selected photo could not be read.");

    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Photo processing is not available on this device.");
    ctx.drawImage(image, 0, 0, width, height);
    if (typeof image.close === "function") image.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob) throw new Error("The photo could not be prepared for upload.");
    if (blob.size > 5 * 1024 * 1024) throw new Error("The photo is still too large after optimisation. Try another image.");
    return new File([blob], `vehicle-${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function robustPhotoUpload(card, input, file) {
    const registration = registrationFromCard(card);
    const label = input.closest("label");
    const placeholder = card.querySelector("[data-photo-placeholder]");
    const image = card.querySelector("[data-vehicle-photo]");
    const previousLabel = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const setLabel = (text) => { if (previousLabel) previousLabel.textContent = text; };

    input.disabled = true;
    card.classList.add("is-photo-uploading");
    setLabel("Preparing…");
    setHubMessage(card, "Preparing vehicle photo…");

    let previewUrl = null;
    try {
      const prepared = await normalisePhoto(file);
      previewUrl = URL.createObjectURL(prepared);
      if (image) {
        image.src = previewUrl;
        image.hidden = false;
      }
      if (placeholder) placeholder.hidden = true;
      setLabel("Uploading…");
      setHubMessage(card, "Uploading vehicle photo…");

      const ext = prepared.type === "image/png" ? "png" : prepared.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${registration}/${Date.now()}.${ext}`;
      const profileResult = await client.from("vehicle_profiles").select("*").eq("registration", registration).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const existing = profileResult.data || {};
      const previousPath = existing.photo_path || null;

      const upload = client.storage.from("vehicle-photos").upload(path, prepared, {
        contentType: prepared.type,
        cacheControl: "3600",
        upsert: false,
      });
      const { error: uploadError } = await withTimeout(upload, 20000, "The photo upload timed out. Your app is still usable — try again on a stronger connection.");
      if (uploadError) throw uploadError;

      const record = {
        user_id: user.id,
        registration,
        nickname: existing.nickname || null,
        current_mileage: existing.current_mileage ?? null,
        insurance_renewal_date: existing.insurance_renewal_date || null,
        service_due_date: existing.service_due_date || null,
        service_due_mileage: existing.service_due_mileage ?? null,
        photo_path: path,
        updated_at: new Date().toISOString(),
      };
      const save = await client.from("vehicle_profiles").upsert(record, { onConflict: "user_id,registration" }).select().single();
      if (save.error) {
        client.storage.from("vehicle-photos").remove([path]).catch(() => {});
        throw save.error;
      }

      const signed = await withTimeout(client.storage.from("vehicle-photos").createSignedUrl(path, 3600), 8000, "Photo saved, but the preview took too long to load.");
      if (signed.error) throw signed.error;
      if (image && signed.data?.signedUrl) image.src = signed.data.signedUrl;
      if (previousPath && previousPath !== path) client.storage.from("vehicle-photos").remove([previousPath]).catch(() => {});
      setHubMessage(card, "Vehicle photo updated.", "success");
      setLabel("Change photo");
    } catch (error) {
      setHubMessage(card, error.message || "Vehicle photo could not be uploaded.", "error");
      setLabel("Try photo again");
      if (previewUrl && image) {
        image.removeAttribute("src");
        image.hidden = true;
        if (placeholder) placeholder.hidden = false;
      }
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      input.disabled = false;
      input.value = "";
      card.classList.remove("is-photo-uploading");
    }
  }

  function replacePhotoHandler(card) {
    const oldInput = card.querySelector("[data-photo-input]");
    if (!oldInput || oldInput.dataset.robustUpload === "true") return;
    const input = oldInput.cloneNode(true);
    input.dataset.robustUpload = "true";
    input.accept = "image/*";
    oldInput.replaceWith(input);
    input.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) robustPhotoUpload(card, input, file);
    });
  }

  function installCardReminder(card) {
    if (card.querySelector("[data-card-reminder-toggle]")) {
      reminderButtonState(card);
      return;
    }
    const quickGrid = card.querySelector(".ownership-quick-grid");
    if (!quickGrid) return;

    const existingPushTile = [...quickGrid.children].find((child) => child.textContent.includes("Push reminders"));
    if (existingPushTile) existingPushTile.remove();

    const box = document.createElement("div");
    box.className = "ownership-card-reminder";
    box.innerHTML = `
      <span>MOT & tax reminders</span>
      <button data-card-reminder-toggle type="button" class="ownership-reminder-button">Checking…</button>
      <small data-card-reminder-note>Loading reminder status…</small>
    `;
    quickGrid.append(box);
    const button = box.querySelector("[data-card-reminder-toggle]");
    button.addEventListener("click", () => handleReminderClick(card, button));
    reminderButtonState(card);

    const oldModule = card.querySelector(".ownership-reminder-module");
    if (oldModule) {
      const freshReport = oldModule.querySelector('a[href*="?reg="]');
      if (freshReport) {
        oldModule.innerHTML = '<div class="ownership-module-title"><span>04</span><div><h4>Fresh report</h4><p>Run a new live check whenever you want the latest vehicle record.</p></div></div>';
        oldModule.append(freshReport);
      } else oldModule.remove();
    }
  }

  function decorateCard(card) {
    if (card.dataset.reminderPhotoFixReady === "true") return;
    if (!card.querySelector("[data-photo-input]") || !card.querySelector(".ownership-quick-grid")) return;
    card.dataset.reminderPhotoFixReady = "true";
    replacePhotoHandler(card);
    installCardReminder(card);
  }

  async function initialize() {
    await window.biismoAuth.ready;
    user = window.biismoAuth.getUser();
    client = window.biismoAuth.getClient?.();
    if (!user || !client) return;

    if (originalReminderSection) originalReminderSection.classList.add("is-card-managed");
    await loadReminderState();

    const decorateAll = () => grid.querySelectorAll(".garage-card").forEach(decorateCard);
    decorateAll();
    const observer = new MutationObserver(decorateAll);
    observer.observe(grid, { childList: true, subtree: true });

    window.setTimeout(async () => {
      await loadReminderState();
      refreshReminderButtons();
    }, 1200);
  }

  initialize().catch((error) => console.error("Garage tidy-up could not start:", error));
})();
