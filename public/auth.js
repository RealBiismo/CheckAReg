(() => {
  // Keep auth callbacks inside this isolated Check A Reg deployment.
  const BIISMO_ORIGIN = window.location.origin;
  let client = null;
  let currentUser = null;
  let authMode = "signin";
  let configurationError = null;

  const accountButton = document.getElementById("accountButton");
  const authDialog = document.getElementById("authDialog");
  const authTitle = document.getElementById("authTitle");
  const authForm = document.getElementById("authForm");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authSubmitButton = document.getElementById("authSubmitButton");
  const authMessage = document.getElementById("authMessage");
  const signInTab = document.getElementById("signInTab");
  const signUpTab = document.getElementById("signUpTab");
  const googleAuthButton = document.getElementById("googleAuthButton");
  const forgotPasswordButton = document.getElementById("forgotPasswordButton");

  function installBiismoAuthBrand() {
    if (!document.querySelector('link[href="/auth-brand.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/auth-brand.css";
      document.head.append(link);
    }
    if (!authDialog || authDialog.querySelector(".biismo-auth-brand")) return;
    const brand = document.createElement("div");
    brand.className = "biismo-auth-brand";
    brand.innerHTML = '<img src="/icon.svg" alt="Check A Reg"><div><strong>CHECK A REG</strong><span>Secure account access</span></div>';
    authDialog.prepend(brand);
    const legal = authDialog.querySelector(".auth-legal");
    if (legal) legal.textContent = "Secure sign-in for your Check A Reg account. New email accounts must confirm their email before signing in.";
  }

  function friendlyAuthError(error, fallback = "We couldn't complete that account request. Please try again.") {
    const raw = String(error?.message || error || "").toLowerCase();
    if (!raw) return fallback;
    if (raw.includes("invalid login credentials")) return "That email or password doesn't match a Check A Reg account.";
    if (raw.includes("email not confirmed")) return "Confirm your email first, then come back and sign in.";
    if (raw.includes("user already registered")) return "A Check A Reg account already exists with that email.";
    if (raw.includes("password") && (raw.includes("weak") || raw.includes("characters"))) return "Choose a stronger password with at least 8 characters.";
    if (raw.includes("rate limit") || raw.includes("too many")) return "Too many attempts. Wait a moment and try again.";
    if (raw.includes("network") || raw.includes("fetch") || raw.includes("timeout")) return "CHECK A REG couldn't reach the account service. Check your connection and try again.";
    if (raw.includes("provider") || raw.includes("oauth")) return "Google sign-in couldn't be completed. Please try again.";
    return fallback;
  }

  function setAuthMessage(message, type = "") {
    if (!authMessage) return;
    authMessage.textContent = message;
    authMessage.className = `auth-message ${type ? `is-${type}` : ""}`.trim();
  }

  function updateAccountButton() {
    if (!accountButton) return;
    accountButton.textContent = currentUser ? "My garage" : "Sign in";
    accountButton.classList.toggle("is-signed-in", Boolean(currentUser));
  }

  function setAuthMode(mode) {
    authMode = mode;
    if (!authTitle || !authSubmitButton) return;

    const isSignUp = mode === "signup";
    const isRecovery = mode === "recovery";
    authDialog?.classList.toggle("is-recovery", isRecovery);
    authTitle.textContent = isRecovery
      ? "Reset your CHECK A REG password"
      : isSignUp
        ? "Create your CHECK A REG account"
        : "Welcome back";
    authSubmitButton.textContent = isRecovery
      ? "Save new password"
      : isSignUp
        ? "Create account"
        : "Sign in";

    signInTab?.classList.toggle("is-active", mode === "signin");
    signUpTab?.classList.toggle("is-active", isSignUp);
    signInTab?.setAttribute("aria-selected", String(mode === "signin"));
    signUpTab?.setAttribute("aria-selected", String(isSignUp));

    document.querySelector(".auth-tabs")?.classList.toggle("is-hidden", isRecovery);
    document.getElementById("authEmailLabel")?.classList.toggle("is-hidden", isRecovery);
    if (authEmail) authEmail.classList.toggle("is-hidden", isRecovery);
    if (authPassword) {
      authPassword.autocomplete = isSignUp || isRecovery ? "new-password" : "current-password";
      authPassword.placeholder = isRecovery ? "Choose at least 8 characters" : "At least 8 characters";
    }
    googleAuthButton?.classList.toggle("is-hidden", isRecovery);
    forgotPasswordButton?.classList.toggle("is-hidden", mode !== "signin");
    document.querySelector(".auth-divider")?.classList.toggle("is-hidden", isRecovery);
    setAuthMessage("");
  }

  function openAuthDialog(mode = "signin") {
    installBiismoAuthBrand();
    setAuthMode(mode);
    if (configurationError) setAuthMessage(configurationError, "error");
    if (authDialog && !authDialog.open) authDialog.showModal();
  }

  async function initialize() {
    installBiismoAuthBrand();
    try {
      if (!window.supabase?.createClient) {
        throw new Error("CHECK A REG secure account services could not be loaded.");
      }

      const response = await fetch("/api/config", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || "CHECK A REG account services are unavailable.");

      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      currentUser = data.session?.user || null;
      updateAccountButton();

      client.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        updateAccountButton();
        window.dispatchEvent(
          new CustomEvent("biismo-auth-change", {
            detail: { event, user: currentUser },
          })
        );

        if (event === "PASSWORD_RECOVERY") openAuthDialog("recovery");
      });

      const params = new URLSearchParams(window.location.search);
      if (params.get("login") === "1") openAuthDialog("signin");
      if (params.get("recovery") === "1") openAuthDialog("recovery");

      return true;
    } catch (error) {
      configurationError = friendlyAuthError(error, "CHECK A REG account services are unavailable right now.");
      updateAccountButton();
      return false;
    }
  }

  function requireClient() {
    if (!client) throw new Error(configurationError || "CHECK A REG account services are unavailable.");
    return client;
  }

  async function authorizedFetch(url, options = {}) {
    const supabaseClient = requireClient();
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session?.access_token) throw new Error("Sign in to continue.");

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${data.session.access_token}`);

    return fetch(url, { ...options, headers });
  }

  async function signIn(email, password) {
    const supabaseClient = requireClient();
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password) {
    const supabaseClient = requireClient();
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${BIISMO_ORIGIN}/account.html` },
    });
    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    const supabaseClient = requireClient();
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${BIISMO_ORIGIN}/account.html` },
    });
    if (error) throw error;
  }

  async function signOut() {
    const supabaseClient = requireClient();
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentUser = null;
    updateAccountButton();
  }

  async function saveVehicle(vehicle) {
    const supabaseClient = requireClient();
    if (!currentUser) throw new Error("Sign in to save vehicles to your garage.");

    const latestMileage = [...(vehicle.motHistory || [])]
      .map((test) => ({
        date: new Date(test.completedDate),
        mileage: Number.parseInt(String(test.mileage ?? "").replace(/[^\d]/g, ""), 10),
      }))
      .filter((reading) => !Number.isNaN(reading.date.getTime()) && Number.isFinite(reading.mileage))
      .sort((a, b) => b.date - a.date)[0]?.mileage;

    const record = {
      user_id: currentUser.id,
      registration: vehicle.registration,
      make: vehicle.make || null,
      model: vehicle.model || null,
      colour: vehicle.colour || null,
      tax_status: vehicle.taxStatus || null,
      tax_due_date: vehicle.taxDueDate || null,
      mot_status: vehicle.motStatus || null,
      mot_expiry_date: vehicle.motExpiryDate || null,
      last_mileage: latestMileage ?? null,
      saved_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseClient
      .from("saved_vehicles")
      .upsert(record, { onConflict: "user_id,registration" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listSavedVehicles() {
    const supabaseClient = requireClient();
    if (!currentUser) return [];
    const { data, error } = await supabaseClient
      .from("saved_vehicles")
      .select("*")
      .order("saved_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function removeSavedVehicle(id) {
    const supabaseClient = requireClient();
    if (!currentUser) throw new Error("You are not signed in.");
    const { error } = await supabaseClient.from("saved_vehicles").delete().eq("id", id);
    if (error) throw error;
  }

  const ready = initialize();

  accountButton?.addEventListener("click", async () => {
    await ready;
    if (currentUser) window.location.href = "/account.html";
    else openAuthDialog("signin");
  });
  document.getElementById("closeAuthButton")?.addEventListener("click", () => authDialog.close());
  authDialog?.addEventListener("click", (event) => {
    if (event.target === authDialog) authDialog.close();
  });
  signInTab?.addEventListener("click", () => setAuthMode("signin"));
  signUpTab?.addEventListener("click", () => setAuthMode("signup"));

  googleAuthButton?.addEventListener("click", async () => {
    setAuthMessage("Opening secure Google sign-in…");
    googleAuthButton.disabled = true;
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthMessage(friendlyAuthError(error, "Google sign-in couldn't be completed. Please try again."), "error");
      googleAuthButton.disabled = false;
    }
  });

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;

    if (authMode !== "recovery" && (!authEmail.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) {
      setAuthMessage("Enter a complete email address, such as name@example.com.", "error");
      return;
    }
    if (password.length < 8) {
      setAuthMessage("Your password must be at least 8 characters.", "error");
      return;
    }

    authSubmitButton.disabled = true;
    setAuthMessage(authMode === "signup" ? "Creating your CHECK A REG account…" : authMode === "recovery" ? "Saving your new password…" : "Signing you in…");

    try {
      if (authMode === "recovery") {
        const { error } = await requireClient().auth.updateUser({ password });
        if (error) throw error;
        setAuthMessage("Password updated. Taking you to your account…", "success");
        setTimeout(() => { window.location.href = `${BIISMO_ORIGIN}/account.html`; }, 700);
      } else if (authMode === "signup") {
        const data = await signUp(email, password);
        if (data.session) {
          window.location.href = `${BIISMO_ORIGIN}/account.html`;
        } else {
          setAuthMessage("We've sent a CHECK A REG confirmation email. Open it to activate your account.", "success");
          authForm.reset();
        }
      } else {
        await signIn(email, password);
        window.location.href = `${BIISMO_ORIGIN}/account.html`;
      }
    } catch (error) {
      setAuthMessage(friendlyAuthError(error), "error");
    } finally {
      authSubmitButton.disabled = false;
    }
  });

  forgotPasswordButton?.addEventListener("click", async () => {
    const email = authEmail.value.trim().toLowerCase();
    if (!authEmail.validity.valid || !email) {
      setAuthMessage("Enter your email address first.", "error");
      return;
    }

    forgotPasswordButton.disabled = true;
    setAuthMessage("Sending your CHECK A REG reset link…");
    try {
      const { error } = await requireClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${BIISMO_ORIGIN}/?recovery=1`,
      });
      if (error) throw error;
      setAuthMessage("Reset link sent. Check your inbox and follow the CHECK A REG password reset link.", "success");
    } catch (error) {
      setAuthMessage(friendlyAuthError(error, "The reset email couldn't be sent. Please try again."), "error");
    } finally {
      forgotPasswordButton.disabled = false;
    }
  });

  window.biismoAuth = {
    ready,
    getUser: () => currentUser,
    getClient: () => client,
    isConfigured: () => Boolean(client),
    openAuthDialog,
    signOut,
    authorizedFetch,
    saveVehicle,
    listSavedVehicles,
    removeSavedVehicle,
  };
})();
