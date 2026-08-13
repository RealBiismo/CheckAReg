(() => {
  if (window.location.pathname !== "/account.html") return;

  const byId = (id) => document.getElementById(id);
  const MEDIA_BUCKET = "account-media";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  let client;
  let user;
  let profile = null;
  let overview = null;
  let myTickets = [];
  let adminTickets = [];
  let selectedUserTicketId = null;
  let selectedAdminTicketId = null;
  let conversationPoll = null;
  let loaded = false;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const formatDate = (value, withTime = false) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not available";
    return date.toLocaleString("en-GB", withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" });
  };

  const statusLabel = (value) => ({
    open: "Open",
    in_progress: "In progress",
    waiting_on_user: "Waiting on you",
    resolved: "Resolved",
    closed: "Closed",
  })[value] || "Open";

  const categoryLabel = (value) => ({
    bug: "Bug",
    vehicle_data: "Vehicle data",
    billing: "Billing",
    account: "Account",
    suggestion: "Suggestion",
    other: "Other",
  })[value] || "Support";

  function setStatus(id, message, type = "") {
    const node = byId(id);
    if (!node) return;
    node.textContent = message;
    node.className = `${node.classList.contains("admin-status") ? "admin-status" : "hub-status"}${type ? ` is-${type}` : ""}`;
  }

  function displayName() {
    return profile?.display_name?.trim() || String(user?.email || "Driver").split("@")[0] || "Driver";
  }

  function initials() {
    const parts = displayName().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || "CR").toUpperCase();
  }

  async function signedMediaUrl(path, expiresIn = 3600) {
    if (!path) return null;
    const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data?.signedUrl || null;
  }

  async function renderAvatar() {
    const avatar = byId("profileAvatar");
    if (!avatar) return;
    avatar.innerHTML = `<span id="profileInitials">${escapeHtml(initials())}</span>`;
    byId("removeProfileAvatarButton").hidden = !profile?.avatar_path;
    if (!profile?.avatar_path) return;
    try {
      const url = await signedMediaUrl(profile.avatar_path);
      if (!url) return;
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${displayName()}'s profile photo`;
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.replaceChildren(image);
    } catch {
      // Initials remain a safe fallback if the private image cannot be opened.
    }
  }

  function renderProfile() {
    byId("profileDisplayName").value = profile?.display_name || "";
    byId("profileEmail").textContent = user.email || "Signed in securely";
    byId("profileGreeting").textContent = `${profile?.display_name ? `Hi, ${displayName().split(/\s+/)[0]}.` : "Your account."}`;
    byId("profileReminderPreference").checked = profile?.notify_vehicle_reminders !== false;
    byId("profileProductPreference").checked = Boolean(profile?.notify_product_updates);
    renderAvatar();
  }

  function renderOverview(allowance = {}) {
    const values = {
      profileJoinedAt: overview?.joinedAt ? formatDate(overview.joinedAt) : "—",
      profileProvider: `${String(overview?.provider || "email").replace(/^./, (character) => character.toUpperCase())} sign-in`,
      profileCreditBalance: Number(allowance.credits) || 0,
      profileFreeChecks: Number(allowance.freeRemaining) || 0,
      profileSavedVehicles: Number(overview?.savedVehicles) || 0,
      profileTotalSearches: Number(overview?.totalSearches) || 0,
      profileAiQuestions: Number(overview?.aiQuestions) || 0,
      profileOpenTickets: Number(overview?.openTickets) || 0,
    };
    Object.entries(values).forEach(([id, value]) => { if (byId(id)) byId(id).textContent = String(value); });
  }

  async function ensureProfile() {
    const { data, error } = await client.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const created = await client.from("user_profiles").insert({ user_id: user.id }).select("*").single();
    if (created.error) throw created.error;
    return created.data;
  }

  async function loadOverview() {
    const [rpcResult, allowanceResponse] = await Promise.all([
      client.rpc("get_my_account_overview"),
      window.biismoAuth.authorizedFetch("/api/allowance", { cache: "no-store" }),
    ]);
    if (rpcResult.error) throw rpcResult.error;
    const allowance = await allowanceResponse.json();
    if (!allowanceResponse.ok) throw new Error(allowance.error || "Your account overview could not be loaded.");
    overview = rpcResult.data || {};
    renderOverview(allowance);
  }

  function renderMessages(items, targetId) {
    const target = byId(targetId);
    if (!target) return;
    if (!items.length) {
      target.innerHTML = '<p class="notification-empty">No messages in this conversation yet.</p>';
      return;
    }
    target.innerHTML = items.map((item) => {
      const senderType = item.senderType || item.sender_type;
      const createdAt = item.createdAt || item.created_at;
      return `<article class="support-message is-${senderType === "staff" ? "staff" : "user"}">
        <div><strong>${senderType === "staff" ? "Check A Reg" : "You"}</strong><time>${escapeHtml(formatDate(createdAt, true))}</time></div>
        <p>${escapeHtml(item.message)}</p>
      </article>`;
    }).join("");
    target.scrollTop = target.scrollHeight;
  }

  function renderMyTickets() {
    const list = byId("mySupportTickets");
    if (!list) return;
    if (!myTickets.length) {
      list.innerHTML = '<p class="notification-empty">No support tickets yet.</p>';
      return;
    }
    list.innerHTML = myTickets.map((ticket) => `
      <button class="ticket-row ${ticket.id === selectedUserTicketId ? "is-active" : ""}" type="button" data-user-ticket-id="${escapeHtml(ticket.id)}">
        <span><b>${escapeHtml(categoryLabel(ticket.category))}</b><small>${escapeHtml(statusLabel(ticket.status))}</small></span>
        <strong>${escapeHtml(ticket.subject)}</strong>
        <time>${escapeHtml(formatDate(ticket.updated_at || ticket.created_at, true))}</time>
      </button>`).join("");
  }

  async function loadMyTickets() {
    const { data, error } = await client.from("support_tickets")
      .select("id,category,subject,description,registration,status,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    myTickets = data || [];
    renderMyTickets();
  }

  function showConversationPanel(mode) {
    const shell = document.querySelector(".support-inbox-shell");
    byId("supportTicketForm").hidden = mode !== "new";
    byId("supportConversation").hidden = mode !== "thread";
    byId("supportConversationEmpty").hidden = mode !== "empty";
    shell?.classList.toggle("is-viewing-thread", mode !== "empty");
  }

  async function openUserConversation(id, { quiet = false } = {}) {
    const ticket = myTickets.find((item) => item.id === id);
    if (!ticket) return;
    selectedUserTicketId = id;
    renderMyTickets();
    showConversationPanel("thread");
    if (!quiet) setStatus("userSupportReplyStatus", "Loading conversation…");
    const { data, error } = await client.from("support_ticket_messages")
      .select("id,sender_type,message,created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      setStatus("userSupportReplyStatus", error.message || "This conversation could not be loaded.", "error");
      return;
    }
    byId("supportConversationMeta").textContent = `${categoryLabel(ticket.category)} · ${formatDate(ticket.created_at)}`;
    byId("supportConversationTitle").textContent = ticket.subject;
    byId("supportConversationStatus").textContent = statusLabel(ticket.status);
    renderMessages(data || [], "userSupportMessages");
    const closed = ticket.status === "closed";
    byId("userSupportReply").disabled = closed;
    byId("sendUserSupportReplyButton").disabled = closed;
    byId("userSupportReply").placeholder = closed ? "This conversation is closed." : "Write a reply…";
    if (!quiet) setStatus("userSupportReplyStatus", closed ? "This conversation is closed." : "");
  }

  function openNewTicket() {
    selectedUserTicketId = null;
    renderMyTickets();
    byId("supportTicketForm").reset();
    setStatus("supportFormStatus", "");
    showConversationPanel("new");
    byId("supportSubject").focus();
  }

  async function loadAccountHub() {
    if (loaded) return;
    loaded = true;
    try {
      [profile] = await Promise.all([ensureProfile(), loadOverview(), loadMyTickets()]);
      renderProfile();
    } catch (error) {
      loaded = false;
      setStatus("profileDetailsStatus", error.message || "Your account could not be loaded.", "error");
    }
  }

  async function prepareImage(file, maxDimension) {
    if (!file || !/^image\/(?:jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is over 5MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!blob) throw new Error("That image could not be prepared.");
    return blob;
  }

  async function saveProfile(changes) {
    const { data, error } = await client.from("user_profiles").update(changes).eq("user_id", user.id).select("*").single();
    if (error) throw error;
    profile = data;
    renderProfile();
  }

  async function uploadAvatar(file) {
    const button = document.querySelector('label[for="profileAvatarInput"]');
    setStatus("profileDetailsStatus", "Preparing your photo…");
    button.classList.add("is-busy");
    try {
      const image = await prepareImage(file, 512);
      const path = `avatars/${user.id}/avatar.webp`;
      const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, image, { contentType: "image/webp", upsert: true, cacheControl: "3600" });
      if (error) throw error;
      await saveProfile({ avatar_path: path });
      setStatus("profileDetailsStatus", "Profile photo updated.", "success");
    } catch (error) {
      setStatus("profileDetailsStatus", error.message || "Your photo could not be saved.", "error");
    } finally {
      button.classList.remove("is-busy");
      byId("profileAvatarInput").value = "";
    }
  }

  async function createTicket({ id = crypto.randomUUID(), category, subject, description, registration = null, screenshot = null }) {
    let screenshotPath = null;
    if (screenshot) {
      const image = await prepareImage(screenshot, 1600);
      screenshotPath = `support/${user.id}/${id}.webp`;
      const upload = await client.storage.from(MEDIA_BUCKET).upload(screenshotPath, image, { contentType: "image/webp", upsert: false, cacheControl: "3600" });
      if (upload.error) throw upload.error;
    }

    const insert = await client.from("support_tickets").insert({
      id,
      user_id: user.id,
      category,
      subject: subject.trim(),
      description: description.trim(),
      registration: registration || null,
      screenshot_path: screenshotPath,
      page_url: window.location.href.slice(0, 500),
      user_agent: navigator.userAgent.slice(0, 500),
    }).select("id").single();

    if (insert.error) {
      if (screenshotPath) await client.storage.from(MEDIA_BUCKET).remove([screenshotPath]);
      throw insert.error;
    }
    return insert.data;
  }

  function downloadJson(filename, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadAdminTickets() {
    if (!client || !document.body.dataset.staffRole || document.body.dataset.staffRole === "user") return;
    const filter = byId("adminSupportStatusFilter")?.value || null;
    setStatus("adminSupportStatus", "Loading support tickets…");
    const { data, error } = await client.rpc("staff_list_support_tickets", { p_status: filter, p_limit: 75 });
    if (error) {
      setStatus("adminSupportStatus", error.message || "Tickets could not be loaded.", "error");
      return;
    }
    adminTickets = Array.isArray(data?.tickets) ? data.tickets : [];
    setStatus("adminSupportStatus", `${adminTickets.length} ${adminTickets.length === 1 ? "ticket" : "tickets"} shown.`, "success");
    renderAdminTickets();
  }

  function renderAdminTickets() {
    const list = byId("adminSupportTicketList");
    if (!list) return;
    if (!adminTickets.length) {
      list.innerHTML = '<p class="notification-empty">No tickets match this filter.</p>';
      byId("adminSupportTicketDetail").hidden = true;
      return;
    }
    list.innerHTML = adminTickets.map((ticket) => `
      <button class="admin-ticket-row ${ticket.id === selectedAdminTicketId ? "is-active" : ""}" type="button" data-support-ticket-id="${escapeHtml(ticket.id)}">
        <div><span>${escapeHtml(categoryLabel(ticket.category))}</span><small>${escapeHtml(statusLabel(ticket.status))}</small></div>
        <strong>${escapeHtml(ticket.subject)}</strong><small>${escapeHtml(ticket.email)} · ${Number(ticket.messageCount) || 0} messages · ${escapeHtml(formatDate(ticket.updated_at || ticket.created_at, true))}</small>
      </button>`).join("");
  }

  async function showAdminTicket(id) {
    selectedAdminTicketId = id;
    renderAdminTickets();
    setStatus("adminSupportStatus", "Loading conversation…");
    const { data, error } = await client.rpc("staff_get_support_thread", { p_ticket_id: id });
    if (error) {
      setStatus("adminSupportStatus", error.message || "This conversation could not be loaded.", "error");
      return;
    }
    const ticket = data?.ticket;
    if (!ticket) return;
    const detail = byId("adminSupportTicketDetail");
    byId("adminSupportTicketContent").innerHTML = `
      <span class="eyebrow">${escapeHtml(categoryLabel(ticket.category))} · ${escapeHtml(statusLabel(ticket.status))}</span>
      <h3>${escapeHtml(ticket.subject)}</h3>
      <p class="admin-ticket-meta">${escapeHtml(ticket.email)} · ${escapeHtml(formatDate(ticket.createdAt, true))}</p>
      <div class="admin-ticket-context">${ticket.registration ? `<span>Registration: ${escapeHtml(ticket.registration)}</span>` : ""}${ticket.pageUrl ? `<span>Page: ${escapeHtml(ticket.pageUrl)}</span>` : ""}${ticket.userAgent ? `<span>Device: ${escapeHtml(ticket.userAgent)}</span>` : ""}</div>
      ${ticket.screenshotPath ? '<a id="adminTicketScreenshotLink" class="admin-ticket-screenshot" target="_blank" rel="noopener">Open attached screenshot ↗</a>' : ""}`;
    renderMessages(Array.isArray(data.messages) ? data.messages : [], "adminSupportMessages");
    byId("adminSupportReply").value = "";
    byId("adminSupportTicketStatus").value = ticket.status;
    detail.hidden = false;
    setStatus("adminSupportStatus", "Conversation loaded.", "success");
    if (ticket.screenshotPath) {
      try {
        const url = await signedMediaUrl(ticket.screenshotPath, 900);
        const link = byId("adminTicketScreenshotLink");
        if (link && url) link.href = url;
        else link?.remove();
      } catch {
        byId("adminTicketScreenshotLink")?.remove();
      }
    }
  }

  function installListeners() {
    byId("profileMenuButton")?.addEventListener("click", loadAccountHub);
    byId("profileAvatarInput")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) uploadAvatar(file);
    });
    byId("removeProfileAvatarButton")?.addEventListener("click", async () => {
      if (!profile?.avatar_path || !window.confirm("Remove your profile photo?")) return;
      try {
        await client.storage.from(MEDIA_BUCKET).remove([profile.avatar_path]);
        await saveProfile({ avatar_path: null });
        setStatus("profileDetailsStatus", "Profile photo removed.", "success");
      } catch (error) { setStatus("profileDetailsStatus", error.message || "Your photo could not be removed.", "error"); }
    });
    byId("profileDetailsForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = byId("profileDisplayName").value.trim();
      if (name.length > 50) return setStatus("profileDetailsStatus", "Keep your display name to 50 characters.", "error");
      try {
        await saveProfile({ display_name: name || null });
        setStatus("profileDetailsStatus", "Profile saved.", "success");
      } catch (error) { setStatus("profileDetailsStatus", error.message || "Your profile could not be saved.", "error"); }
    });
    byId("profilePreferencesForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await saveProfile({ notify_vehicle_reminders: byId("profileReminderPreference").checked, notify_product_updates: byId("profileProductPreference").checked });
        setStatus("profilePreferencesStatus", "Preferences saved.", "success");
      } catch (error) { setStatus("profilePreferencesStatus", error.message || "Preferences could not be saved.", "error"); }
    });
    byId("changeEmailForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = byId("profileNewEmail").value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return setStatus("profileSecurityStatus", "Enter a complete email address.", "error");
      const { error } = await client.auth.updateUser({ email });
      if (error) return setStatus("profileSecurityStatus", error.message || "Your email could not be changed.", "error");
      byId("profileNewEmail").value = "";
      setStatus("profileSecurityStatus", "Check both email addresses for confirmation links.", "success");
    });
    byId("changePasswordForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = byId("profileNewPassword").value;
      if (password.length < 8) return setStatus("profileSecurityStatus", "Use at least 8 characters.", "error");
      const { error } = await client.auth.updateUser({ password });
      if (error) return setStatus("profileSecurityStatus", error.message || "Your password could not be changed.", "error");
      byId("profileNewPassword").value = "";
      setStatus("profileSecurityStatus", "Password changed.", "success");
    });
    byId("supportTicketForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = byId("submitSupportTicketButton");
      const registration = byId("supportRegistration").value.toUpperCase().replace(/[\s-]/g, "");
      if (registration && !/^[A-Z0-9]{2,8}$/.test(registration)) return setStatus("supportFormStatus", "Check the registration or leave it blank.", "error");
      submit.disabled = true;
      setStatus("supportFormStatus", "Sending your ticket securely…");
      try {
        const ticket = await createTicket({ category: byId("supportCategory").value, subject: byId("supportSubject").value, description: byId("supportDescription").value, registration, screenshot: byId("supportScreenshot").files?.[0] || null });
        form.reset();
        await Promise.all([loadMyTickets(), loadOverview()]);
        await openUserConversation(ticket.id);
        setStatus("userSupportReplyStatus", "Conversation started. We’ll reply here.", "success");
      } catch (error) { setStatus("supportFormStatus", error.message || "Your ticket could not be sent.", "error"); }
      finally { submit.disabled = false; }
    });
    byId("refreshMyTicketsButton")?.addEventListener("click", () => loadMyTickets().catch((error) => setStatus("supportFormStatus", error.message, "error")));
    byId("newSupportTicketButton")?.addEventListener("click", openNewTicket);
    byId("cancelNewTicketButton")?.addEventListener("click", () => showConversationPanel(selectedUserTicketId ? "thread" : "empty"));
    byId("backToTicketListButton")?.addEventListener("click", () => document.querySelector(".support-inbox-shell")?.classList.remove("is-viewing-thread"));
    byId("mySupportTickets")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-user-ticket-id]");
      if (row) openUserConversation(row.dataset.userTicketId);
    });
    byId("userSupportReplyForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selectedUserTicketId) return;
      const textarea = byId("userSupportReply");
      const message = textarea.value.trim();
      if (!message) return;
      const button = byId("sendUserSupportReplyButton");
      button.disabled = true;
      setStatus("userSupportReplyStatus", "Sending…");
      try {
        const { error } = await client.from("support_ticket_messages").insert({ ticket_id: selectedUserTicketId, sender_id: user.id, sender_type: "user", message });
        if (error) throw error;
        textarea.value = "";
        await Promise.all([loadMyTickets(), loadOverview()]);
        await openUserConversation(selectedUserTicketId, { quiet: true });
        setStatus("userSupportReplyStatus", "Sent.", "success");
      } catch (error) { setStatus("userSupportReplyStatus", error.message || "Your reply could not be sent.", "error"); }
      finally { button.disabled = false; }
    });
    byId("exportAccountDataButton")?.addEventListener("click", async () => {
      setStatus("profilePrivacyStatus", "Preparing your download…");
      try {
        const vehicles = await window.biismoAuth.listSavedVehicles();
        downloadJson(`check-a-reg-data-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), account: { email: user.email, joinedAt: overview?.joinedAt, provider: overview?.provider }, profile, overview, savedVehicles: vehicles, supportTickets: myTickets });
        setStatus("profilePrivacyStatus", "Your data download is ready.", "success");
      } catch (error) { setStatus("profilePrivacyStatus", error.message || "Your data could not be downloaded.", "error"); }
    });
    byId("requestDeletionButton")?.addEventListener("click", async () => {
      if (!window.confirm("Send an account deletion request? Support will verify it before anything is removed.")) return;
      try {
        await createTicket({ category: "account", subject: "Account deletion request", description: "Please contact me to verify and permanently delete my Check A Reg account and associated personal data." });
        await Promise.all([loadMyTickets(), loadOverview()]);
        setStatus("profilePrivacyStatus", "Deletion request sent. Nothing is removed until support verifies it.", "success");
      } catch (error) { setStatus("profilePrivacyStatus", error.message || "The request could not be sent.", "error"); }
    });
    byId("adminSupportStatusFilter")?.addEventListener("change", loadAdminTickets);
    byId("refreshAdminSupportButton")?.addEventListener("click", loadAdminTickets);
    byId("adminSupportTicketList")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-support-ticket-id]");
      if (row) showAdminTicket(row.dataset.supportTicketId);
    });
    byId("adminSupportReplyForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selectedAdminTicketId) return;
      const button = byId("saveAdminSupportTicketButton");
      const response = byId("adminSupportReply").value.trim();
      button.disabled = true;
      try {
        const { error } = await client.rpc("staff_update_support_ticket", { p_ticket_id: selectedAdminTicketId, p_status: byId("adminSupportTicketStatus").value, p_response: response || null });
        if (error) throw error;
        await loadAdminTickets();
        await showAdminTicket(selectedAdminTicketId);
        setStatus("adminSupportStatus", response ? "Reply sent." : "Ticket status updated.", "success");
      } catch (error) { setStatus("adminSupportStatus", error.message || "The ticket could not be updated.", "error"); }
      finally { button.disabled = false; }
    });
  }

  async function init() {
    await window.biismoAuth.ready;
    user = window.biismoAuth.getUser();
    client = window.biismoAuth.getClient();
    if (!user || !client) return;
    installListeners();
    window.checkARegSupport = { loadAdminTickets };
    await loadAccountHub();
    conversationPoll = window.setInterval(async () => {
      if (document.hidden || byId("profileView")?.hidden || !selectedUserTicketId) return;
      await loadMyTickets().catch(() => {});
      if (myTickets.some((ticket) => ticket.id === selectedUserTicketId)) await openUserConversation(selectedUserTicketId, { quiet: true });
    }, 20000);
    window.addEventListener("pagehide", () => window.clearInterval(conversationPoll), { once: true });
  }

  void init();
})();
