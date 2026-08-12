(() => {
  const grid = document.getElementById("savedVehicles");
  if (!grid || !window.biismoAuth) return;

  let client = null;
  let user = null;

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

  async function decodeImage(file) {
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {}
    }

    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("That photo format is not supported by this device. Try choosing it from your Photos app or saving it as JPG first."));
        img.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function prepareAnyPhoto(file) {
    if (!file || !file.size) throw new Error("Choose a photo first.");

    const image = await withTimeout(
      decodeImage(file),
      15000,
      "The photo took too long to open. Try choosing it again."
    );

    const sourceWidth = image.width || image.naturalWidth;
    const sourceHeight = image.height || image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("The selected photo could not be read.");

    // Keep enough resolution for a crisp card while avoiding giant phone uploads.
    // Small images are not rejected or enlarged here; CSS cover handles filling the card.
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Photo processing is not available on this device.");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    if (typeof image.close === "function") image.close();

    let quality = 0.88;
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    while (blob && blob.size > 4.7 * 1024 * 1024 && quality > 0.62) {
      quality -= 0.08;
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    }

    if (!blob) throw new Error("The photo could not be prepared for upload.");
    if (blob.size > 5 * 1024 * 1024) throw new Error("That photo is too large to upload even after optimisation. Try a different image.");

    return new File([blob], `vehicle-${Date.now()}.jpg`, { type: "image/jpeg" });
  }

  async function uploadPhoto(card, input, file) {
    const registration = registrationFromCard(card);
    if (!registration) throw new Error("This vehicle could not be identified.");

    const label = input.closest("label");
    const image = card.querySelector("[data-vehicle-photo]");
    const placeholder = card.querySelector("[data-photo-placeholder]");
    const textNode = label ? [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) : null;
    const setLabel = (text) => { if (textNode) textNode.textContent = text; };

    input.disabled = true;
    card.classList.add("is-photo-uploading");
    setLabel("Preparing…");
    setHubMessage(card, "Preparing vehicle photo…");

    let previewUrl = null;
    try {
      const prepared = await prepareAnyPhoto(file);
      previewUrl = URL.createObjectURL(prepared);
      if (image) {
        image.src = previewUrl;
        image.hidden = false;
      }
      if (placeholder) placeholder.hidden = true;

      setLabel("Uploading…");
      setHubMessage(card, "Uploading vehicle photo…");

      const profileResult = await client
        .from("vehicle_profiles")
        .select("*")
        .eq("registration", registration)
        .maybeSingle();
      if (profileResult.error) throw profileResult.error;

      const existing = profileResult.data || {};
      const previousPath = existing.photo_path || null;
      const path = `${user.id}/${registration}/${Date.now()}.jpg`;

      const { error: uploadError } = await withTimeout(
        client.storage.from("vehicle-photos").upload(path, prepared, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        }),
        20000,
        "The photo upload timed out. Try again on a stronger connection."
      );
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

      const save = await client
        .from("vehicle_profiles")
        .upsert(record, { onConflict: "user_id,registration" })
        .select()
        .single();
      if (save.error) {
        client.storage.from("vehicle-photos").remove([path]).catch(() => {});
        throw save.error;
      }

      const signed = await withTimeout(
        client.storage.from("vehicle-photos").createSignedUrl(path, 3600),
        8000,
        "Photo saved, but the preview took too long to reload."
      );
      if (signed.error) throw signed.error;
      if (image && signed.data?.signedUrl) image.src = signed.data.signedUrl;
      if (previousPath && previousPath !== path) {
        client.storage.from("vehicle-photos").remove([previousPath]).catch(() => {});
      }

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

  function replaceInput(card) {
    const current = card.querySelector("[data-photo-input]");
    if (!current || current.dataset.anyPhoto === "true") return;

    const input = current.cloneNode(true);
    input.dataset.anyPhoto = "true";
    input.accept = "image/*,.heic,.heif,.avif,.gif,.bmp,.tif,.tiff";
    current.replaceWith(input);

    input.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) uploadPhoto(card, input, file);
    });
  }

  async function initialize() {
    await window.biismoAuth.ready;
    user = window.biismoAuth.getUser();
    client = window.biismoAuth.getClient?.();
    if (!user || !client) return;

    const decorate = () => grid.querySelectorAll(".garage-card").forEach(replaceInput);
    decorate();
    new MutationObserver(decorate).observe(grid, { childList: true, subtree: true });
  }

  initialize().catch((error) => console.error("Garage photo compatibility could not start:", error));
})();
