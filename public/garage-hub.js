(() => {
  const garageGrid = document.getElementById("savedVehicles");
  if (!garageGrid || !window.biismoAuth) return;

  const profiles = new Map();
  let client = null;
  let user = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function registrationFromCard(card) {
    return String(card.querySelector(".mini-plate")?.textContent || "")
      .replace(/^GB/i, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }

  function formatDate(value) {
    if (!value) return "Not set";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }

  function deadlineLabel(value) {
    if (!value) return { text: "Not set", tone: "neutral" };
    const target = new Date(`${value}T00:00:00`);
    if (Number.isNaN(target.getTime())) return { text: "Not set", tone: "neutral" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((target - today) / 86400000);
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "bad" };
    if (days === 0) return { text: "Due today", tone: "bad" };
    if (days <= 30) return { text: `${days}d left`, tone: "warning" };
    return { text: `${days}d left`, tone: "good" };
  }

  function valueOrNull(input) {
    const value = input.value.trim();
    return value === "" ? null : value;
  }

  function integerOrNull(input) {
    const value = input.value.trim();
    if (!value) return null;
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : null;
  }

  function setMessage(card, message, tone = "") {
    const element = card.querySelector("[data-hub-message]");
    if (!element) return;
    element.textContent = message;
    element.className = `ownership-message ${tone ? `is-${tone}` : ""}`.trim();
  }

  async function signedPhotoUrl(path) {
    if (!path) return null;
    const { data, error } = await client.storage.from("vehicle-photos").createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl || null;
  }

  async function refreshPhoto(card, profile) {
    const image = card.querySelector("[data-vehicle-photo]");
    const placeholder = card.querySelector("[data-photo-placeholder]");
    if (!image || !placeholder) return;
    const url = await signedPhotoUrl(profile?.photo_path);
    if (url) {
      image.src = url;
      image.hidden = false;
      placeholder.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      placeholder.hidden = false;
    }
  }

  function updateSummary(card, profile = {}) {
    const nickname = card.querySelector("[data-nickname-display]");
    const mileage = card.querySelector("[data-mileage-summary]");
    const insurance = card.querySelector("[data-insurance-summary]");
    const service = card.querySelector("[data-service-summary]");
    const originalTitle = card.querySelector("h3:not(.vehicle-nickname)");

    if (nickname) {
      nickname.textContent = profile.nickname || "Add a nickname";
      nickname.classList.toggle("is-placeholder", !profile.nickname);
    }
    if (mileage) {
      mileage.textContent = profile.current_mileage == null ? "Not set" : `${Number(profile.current_mileage).toLocaleString()} mi`;
    }
    if (insurance) {
      const deadline = deadlineLabel(profile.insurance_renewal_date);
      insurance.innerHTML = `<strong>${escapeHtml(formatDate(profile.insurance_renewal_date))}</strong><small class="is-${deadline.tone}">${escapeHtml(deadline.text)}</small>`;
    }
    if (service) {
      const deadline = deadlineLabel(profile.service_due_date);
      const mileageText = profile.service_due_mileage == null ? "" : ` · ${Number(profile.service_due_mileage).toLocaleString()} mi`;
      service.innerHTML = `<strong>${escapeHtml(formatDate(profile.service_due_date))}${escapeHtml(mileageText)}</strong><small class="is-${deadline.tone}">${escapeHtml(deadline.text)}</small>`;
    }
    if (originalTitle) originalTitle.classList.add("ownership-model-title");
  }

  function maintenanceMarkup(items) {
    if (!items.length) return '<p class="ownership-empty">No maintenance entries yet. Add services, repairs, tyres or simple ownership notes here.</p>';
    return items.map((item) => {
      const cost = item.cost_pence == null ? "" : ` · £${(Number(item.cost_pence) / 100).toFixed(2)}`;
      const mileage = item.mileage == null ? "" : ` · ${Number(item.mileage).toLocaleString()} mi`;
      return `<article class="maintenance-entry">
        <div><span>${escapeHtml(String(item.category || "note").toUpperCase())}</span><time>${escapeHtml(formatDate(item.event_date))}</time></div>
        <strong>${escapeHtml(item.title)}</strong>
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
        <small>${escapeHtml(`${mileage}${cost}`.replace(/^ · /, ""))}</small>
        <button type="button" data-delete-maintenance="${escapeHtml(item.id)}">Delete</button>
      </article>`;
    }).join("");
  }

  function historyMarkup(items, registration) {
    if (!items.length) return '<p class="ownership-empty">No completed checks are recorded for this saved registration yet.</p>';
    return items.map((item) => `<article class="check-history-entry">
      <div><strong>Vehicle check</strong><time>${escapeHtml(formatDateTime(item.searched_at))}</time></div>
      <small>${Number(item.credit_cost) > 0 ? `${Number(item.credit_cost)} credits used` : "Free daily check"}</small>
      <a href="/?reg=${encodeURIComponent(registration)}">Open current report →</a>
    </article>`).join("");
  }

  async function loadMaintenance(card, registration) {
    const list = card.querySelector("[data-maintenance-list]");
    if (!list) return;
    list.innerHTML = '<p class="ownership-empty">Loading maintenance history…</p>';
    const { data, error } = await client
      .from("vehicle_maintenance")
      .select("id,event_date,category,title,notes,mileage,cost_pence,created_at")
      .eq("registration", registration)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      list.innerHTML = `<p class="ownership-empty">${escapeHtml(error.message || "Maintenance history could not be loaded.")}</p>`;
      return;
    }
    list.innerHTML = maintenanceMarkup(data || []);
    list.querySelectorAll("[data-delete-maintenance]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm("Delete this maintenance entry?")) return;
        button.disabled = true;
        const { error: deleteError } = await client.from("vehicle_maintenance").delete().eq("id", button.dataset.deleteMaintenance);
        if (deleteError) {
          setMessage(card, deleteError.message || "Entry could not be deleted.", "error");
          button.disabled = false;
          return;
        }
        await loadMaintenance(card, registration);
      });
    });
  }

  async function loadCheckHistory(card, registration) {
    const list = card.querySelector("[data-check-history]");
    if (!list) return;
    list.innerHTML = '<p class="ownership-empty">Loading previous checks…</p>';
    const { data, error } = await client.rpc("get_my_vehicle_check_history", { p_registration: registration, p_limit: 12 });
    if (error) {
      list.innerHTML = `<p class="ownership-empty">${escapeHtml(error.message || "Previous checks could not be loaded.")}</p>`;
      return;
    }
    list.innerHTML = historyMarkup(data || [], registration);
  }

  function updateReminderSummary(card, registration) {
    const summary = card.querySelector("[data-reminder-summary]");
    if (!summary) return;
    const options = [...document.querySelectorAll("[data-reminder-vehicle-id]")];
    const option = options.find((input) => input.closest("label")?.querySelector("strong")?.textContent.trim().toUpperCase() === registration);
    if (!option) {
      summary.textContent = "Set in reminder controls";
      summary.className = "ownership-reminder-state is-neutral";
      return;
    }
    summary.textContent = option.checked ? "Active" : "Off";
    summary.className = `ownership-reminder-state ${option.checked ? "is-good" : "is-neutral"}`;
  }

  async function openHub(card, registration) {
    const panel = card.querySelector("[data-ownership-panel]");
    const button = card.querySelector("[data-toggle-hub]");
    if (!panel || !button) return;
    const opening = panel.hidden;
    panel.hidden = !opening;
    card.classList.toggle("is-hub-open", opening);
    button.textContent = opening ? "Close ownership hub" : "Manage vehicle";
    button.setAttribute("aria-expanded", String(opening));
    if (!opening || panel.dataset.loaded === "true") return;
    panel.dataset.loaded = "true";
    updateReminderSummary(card, registration);
    await Promise.all([loadMaintenance(card, registration), loadCheckHistory(card, registration)]);
  }

  async function saveProfile(card, registration) {
    const form = card.querySelector("[data-profile-form]");
    if (!form) return;
    const profile = {
      user_id: user.id,
      registration,
      nickname: valueOrNull(form.querySelector('[name="nickname"]')),
      current_mileage: integerOrNull(form.querySelector('[name="current_mileage"]')),
      insurance_renewal_date: valueOrNull(form.querySelector('[name="insurance_renewal_date"]')),
      service_due_date: valueOrNull(form.querySelector('[name="service_due_date"]')),
      service_due_mileage: integerOrNull(form.querySelector('[name="service_due_mileage"]')),
      photo_path: profiles.get(registration)?.photo_path || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client.from("vehicle_profiles").upsert(profile, { onConflict: "user_id,registration" }).select().single();
    if (error) throw error;
    profiles.set(registration, data);
    updateSummary(card, data);
    setMessage(card, "Vehicle profile saved.", "success");
  }

  async function uploadPhoto(card, registration, file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WebP vehicle photo.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Vehicle photos must be 5 MB or smaller.");

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/${registration}/${Date.now()}.${extension}`;
    const previous = profiles.get(registration)?.photo_path || null;
    const { error: uploadError } = await client.storage.from("vehicle-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const existing = profiles.get(registration) || {};
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
    const { data, error } = await client.from("vehicle_profiles").upsert(record, { onConflict: "user_id,registration" }).select().single();
    if (error) {
      await client.storage.from("vehicle-photos").remove([path]);
      throw error;
    }
    profiles.set(registration, data);
    if (previous && previous !== path) await client.storage.from("vehicle-photos").remove([previous]);
    await refreshPhoto(card, data);
    setMessage(card, "Vehicle photo updated.", "success");
  }

  async function addMaintenance(card, registration) {
    const form = card.querySelector("[data-maintenance-form]");
    const title = form.querySelector('[name="title"]').value.trim();
    if (!title) throw new Error("Add a short title for the maintenance entry.");
    const costValue = form.querySelector('[name="cost"]').value.trim();
    const costPence = costValue === "" ? null : Math.round(Number.parseFloat(costValue) * 100);
    const record = {
      user_id: user.id,
      registration,
      event_date: form.querySelector('[name="event_date"]').value || new Date().toISOString().slice(0, 10),
      category: form.querySelector('[name="category"]').value,
      title,
      notes: valueOrNull(form.querySelector('[name="notes"]')),
      mileage: integerOrNull(form.querySelector('[name="mileage"]')),
      cost_pence: Number.isFinite(costPence) ? costPence : null,
    };
    const { error } = await client.from("vehicle_maintenance").insert(record);
    if (error) throw error;
    form.reset();
    form.querySelector('[name="event_date"]').value = new Date().toISOString().slice(0, 10);
    setMessage(card, "Maintenance entry added.", "success");
    await loadMaintenance(card, registration);
  }

  function hubMarkup(registration, profile = {}) {
    return `
      <div class="ownership-photo">
        <img data-vehicle-photo alt="Your ${escapeHtml(registration)} vehicle" hidden>
        <div data-photo-placeholder class="ownership-photo-placeholder"><span aria-hidden="true">⌁</span><strong>Add your vehicle photo</strong><small>JPG, PNG or WebP · max 5 MB</small></div>
        <label class="ownership-photo-action">${profile.photo_path ? "Change photo" : "Add photo"}<input data-photo-input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
      </div>
      <div class="ownership-identity">
        <h3 data-nickname-display class="vehicle-nickname ${profile.nickname ? "" : "is-placeholder"}">${escapeHtml(profile.nickname || "Add a nickname")}</h3>
      </div>
      <div class="ownership-quick-grid" aria-label="Ownership summary">
        <div><span>Current mileage</span><strong data-mileage-summary>${profile.current_mileage == null ? "Not set" : `${Number(profile.current_mileage).toLocaleString()} mi`}</strong></div>
        <div><span>Insurance renewal</span><div data-insurance-summary><strong>${escapeHtml(formatDate(profile.insurance_renewal_date))}</strong></div></div>
        <div><span>Next service</span><div data-service-summary><strong>${escapeHtml(formatDate(profile.service_due_date))}</strong></div></div>
        <div><span>Push reminders</span><strong data-reminder-summary class="ownership-reminder-state is-neutral">MOT &amp; tax</strong></div>
      </div>
      <button data-toggle-hub class="secondary-button ownership-toggle" type="button" aria-expanded="false">Manage vehicle</button>
      <section data-ownership-panel class="ownership-panel" hidden>
        <div class="ownership-panel-heading"><div><span class="eyebrow">OWNERSHIP HUB</span><h3>${escapeHtml(registration)}</h3></div><p>Keep the useful stuff about this car in one place.</p></div>
        <div class="ownership-panel-grid">
          <section class="ownership-module">
            <div class="ownership-module-title"><span>01</span><div><h4>Vehicle profile</h4><p>Personalise this car and track your latest mileage.</p></div></div>
            <form data-profile-form class="ownership-form">
              <label>Nickname<input name="nickname" maxlength="40" value="${escapeHtml(profile.nickname || "")}" placeholder="e.g. Daily, M3, Family car"></label>
              <label>Current mileage<input name="current_mileage" type="number" min="0" max="2000000" value="${profile.current_mileage ?? ""}" placeholder="62000"></label>
              <label>Insurance renewal<input name="insurance_renewal_date" type="date" value="${escapeHtml(profile.insurance_renewal_date || "")}"></label>
              <label>Next service date<input name="service_due_date" type="date" value="${escapeHtml(profile.service_due_date || "")}"></label>
              <label>Service due mileage<input name="service_due_mileage" type="number" min="0" max="2000000" value="${profile.service_due_mileage ?? ""}" placeholder="65000"></label>
              <button type="submit" class="primary-button">Save vehicle profile</button>
            </form>
            <p class="ownership-future-note">Insurance and service dates are tracked now. Push reminders for these are the next reminder expansion; existing MOT/tax reminders continue as normal.</p>
          </section>
          <section class="ownership-module">
            <div class="ownership-module-title"><span>02</span><div><h4>Maintenance log</h4><p>Build a simple private history for work done to the car.</p></div></div>
            <form data-maintenance-form class="ownership-form maintenance-form">
              <label>Type<select name="category"><option value="service">Service</option><option value="repair">Repair</option><option value="tyres">Tyres</option><option value="brakes">Brakes</option><option value="mot">MOT</option><option value="tax">Tax</option><option value="insurance">Insurance</option><option value="note">Note</option><option value="other">Other</option></select></label>
              <label>Date<input name="event_date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
              <label class="is-wide">Title<input name="title" maxlength="80" placeholder="Oil & filter service" required></label>
              <label>Mileage<input name="mileage" type="number" min="0" max="2000000" placeholder="62000"></label>
              <label>Cost (£)<input name="cost" type="number" min="0" max="1000000" step="0.01" placeholder="149.99"></label>
              <label class="is-wide">Notes<textarea name="notes" maxlength="1000" rows="3" placeholder="Parts used, garage, advisories, anything worth remembering…"></textarea></label>
              <button type="submit" class="secondary-button is-wide">Add maintenance entry</button>
            </form>
            <div data-maintenance-list class="maintenance-list"></div>
          </section>
          <section class="ownership-module">
            <div class="ownership-module-title"><span>03</span><div><h4>Previous checks</h4><p>Your successful CHECK A REG searches for this registration.</p></div></div>
            <div data-check-history class="check-history-list"></div>
          </section>
          <section class="ownership-module ownership-reminder-module">
            <div class="ownership-module-title"><span>04</span><div><h4>Road-ready reminders</h4><p>MOT and tax notifications remain tied to your existing reminder preferences.</p></div></div>
            <button data-reminder-shortcut class="secondary-button" type="button">Open reminder settings</button>
            <a class="secondary-button button-link" href="/?reg=${encodeURIComponent(registration)}">Run fresh vehicle check</a>
          </section>
        </div>
        <p data-hub-message class="ownership-message" role="status"></p>
      </section>`;
  }

  async function decorateCard(card) {
    if (card.dataset.ownershipReady === "true") return;
    const registration = registrationFromCard(card);
    if (!registration) return;
    card.dataset.ownershipReady = "true";
    card.dataset.registration = registration;
    const profile = profiles.get(registration) || {};

    const top = card.querySelector(".garage-card-top");
    if (!top) return;
    top.insertAdjacentHTML("afterend", hubMarkup(registration, profile));
    updateSummary(card, profile);
    await refreshPhoto(card, profile);

    card.querySelector("[data-toggle-hub]")?.addEventListener("click", () => openHub(card, registration));
    card.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try { await saveProfile(card, registration); }
      catch (error) { setMessage(card, error.message || "Vehicle profile could not be saved.", "error"); }
      finally { button.disabled = false; }
    });
    card.querySelector("[data-photo-input]")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.disabled = true;
      try { await uploadPhoto(card, registration, file); }
      catch (error) { setMessage(card, error.message || "Vehicle photo could not be uploaded.", "error"); }
      finally { event.target.disabled = false; event.target.value = ""; }
    });
    card.querySelector("[data-maintenance-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true;
      try { await addMaintenance(card, registration); }
      catch (error) { setMessage(card, error.message || "Maintenance entry could not be saved.", "error"); }
      finally { button.disabled = false; }
    });
    card.querySelector("[data-reminder-shortcut]")?.addEventListener("click", () => {
      document.querySelector(".reminder-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function decorateAll() {
    const cards = [...garageGrid.querySelectorAll(".garage-card")];
    await Promise.all(cards.map(decorateCard));
  }

  async function initialize() {
    await window.biismoAuth.ready;
    user = window.biismoAuth.getUser();
    if (!user) return;
    client = window.biismoAuth.getClient?.();
    if (!client) return;
    const { data, error } = await client.from("vehicle_profiles").select("*").order("updated_at", { ascending: false });
    if (!error) (data || []).forEach((profile) => profiles.set(profile.registration, profile));

    const observer = new MutationObserver(() => decorateAll());
    observer.observe(garageGrid, { childList: true });
    await decorateAll();
  }

  initialize().catch((error) => {
    console.error("Garage ownership hub could not start:", error);
  });
})();
