(() => {
  const result = document.getElementById("result");
  const vehicleForm = document.getElementById("vehicleForm");
  const heroCopy = document.querySelector(".hero-copy");
  const homepageFooterNote = document.querySelector(".homepage-footer-note");
  const regInput = document.getElementById("regInput");
  if (!result || !vehicleForm) return;

  const FEATURES = [
    ["Write-off history", "Insurance category and recorded total-loss history"],
    ["Outstanding finance", "Check for recorded finance agreements"],
    ["Stolen status", "Check against recorded stolen vehicle data"],
    ["Previous keepers", "See the recorded number of former keepers"],
    ["Plate changes", "View recorded registration plate changes"],
    ["Mileage check", "Cross-check mileage records for inconsistencies"],
    ["Import / export", "See recorded import and export markers"],
    ["Vehicle valuation", "Estimated market valuation insights"],
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildPreview(registration) {
    const safeRegistration = escapeHtml(registration || "this vehicle");

    return `
      <section class="full-history-preview is-collapsed" aria-labelledby="fullHistoryPreviewTitle">
        <div class="full-history-preview__summary">
          <div>
            <span class="full-history-preview__eyebrow">FULL VEHICLE HISTORY</span>
            <h3 id="fullHistoryPreviewTitle">Full Vehicle History — £9.99</h3>
            <p>Write-off • Finance • Stolen • Keepers • Mileage + more</p>
          </div>
          <span class="full-history-preview__coming-soon">Coming soon</span>
        </div>

        <button class="full-history-preview__toggle" type="button" aria-expanded="false">
          Preview full report
          <span aria-hidden="true">↓</span>
        </button>

        <div class="full-history-preview__details" hidden>
          <div class="full-history-preview__top">
            <div>
              <h4>See the full story behind ${safeRegistration}</h4>
              <p>Extra provenance checks designed to help you spot costly surprises before buying.</p>
            </div>
            <div class="full-history-preview__price">
              <span>Planned price</span>
              <strong>£9.99</strong>
            </div>
          </div>

          <div class="full-history-preview__grid">
            ${FEATURES.map(([title, description]) => `
              <article class="full-history-preview__item">
                <span class="full-history-preview__lock" aria-hidden="true">🔒</span>
                <div>
                  <strong>${title}</strong>
                  <small>${description}</small>
                </div>
                <span class="full-history-preview__masked" aria-hidden="true">•••</span>
              </article>
            `).join("")}
          </div>

          <button class="full-history-preview__button" type="button" disabled aria-disabled="true">
            Coming soon — Full History £9.99
          </button>
          <p class="full-history-preview__note">Preview only. No payment is taken and no paid history check is currently performed.</p>
        </div>
      </section>
    `;
  }

  function collapseSearchForResult(card) {
    if (!card || document.body.classList.contains("vehicle-result-mode")) return;
    document.body.classList.add("vehicle-result-mode");
    vehicleForm.setAttribute("aria-hidden", "true");
    if (heroCopy) heroCopy.setAttribute("aria-hidden", "true");
    if (homepageFooterNote) homepageFooterNote.setAttribute("aria-hidden", "true");

    if (!card.querySelector(".check-another-vehicle")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "check-another-vehicle secondary-button";
      button.textContent = "← Check another vehicle";
      card.prepend(button);
      button.addEventListener("click", () => {
        result.innerHTML = "";
        document.body.classList.remove("vehicle-result-mode");
        vehicleForm.removeAttribute("aria-hidden");
        if (heroCopy) heroCopy.removeAttribute("aria-hidden");
        if (homepageFooterNote) homepageFooterNote.removeAttribute("aria-hidden");
        if (regInput) {
          regInput.value = "";
          window.setTimeout(() => regInput.focus(), 0);
        }
        vehicleForm.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  function wirePreview(preview) {
    const toggle = preview.querySelector(".full-history-preview__toggle");
    const details = preview.querySelector(".full-history-preview__details");
    if (!toggle || !details || toggle.dataset.wired === "true") return;
    toggle.dataset.wired = "true";
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      details.hidden = open;
      preview.classList.toggle("is-collapsed", open);
      toggle.innerHTML = `${open ? "Preview full report" : "Hide full report preview"}<span aria-hidden="true">${open ? "↓" : "↑"}</span>`;
    });
  }

  function injectPreview() {
    const card = result.querySelector(".result-card:not(.error-state)");
    if (!card) return;

    collapseSearchForResult(card);

    let preview = card.querySelector(".full-history-preview");
    if (!preview) {
      const registration = card.querySelector(".result-reg")?.textContent?.trim();
      const actions = card.querySelector(".actions-row");
      const wrapper = document.createElement("div");
      wrapper.innerHTML = buildPreview(registration);
      preview = wrapper.firstElementChild;
      if (actions) actions.insertAdjacentElement("beforebegin", preview);
      else card.appendChild(preview);
    }

    wirePreview(preview);
  }

  const observer = new MutationObserver(injectPreview);
  observer.observe(result, { childList: true, subtree: true });
  injectPreview();
})();