const vehicleForm = document.getElementById("vehicleForm");
const regInput = document.getElementById("regInput");
const searchButton = document.getElementById("searchButton");
const formError = document.getElementById("formError");
const result = document.getElementById("result");
const loadingOverlay = document.getElementById("loadingOverlay");
const allowanceText = document.getElementById("allowanceText");

function renderAllowance(allowance) {
  if (!allowanceText) return;

  if (!allowance) {
    allowanceText.textContent = "Sign in for 5 free checks each day";
    return;
  }

  const free = Number(allowance.freeRemaining) || 0;
  const credits = Number(allowance.credits) || 0;
  allowanceText.textContent = `${free} free ${free === 1 ? "check" : "checks"} left today • ${credits} ${credits === 1 ? "credit" : "credits"}`;
}

async function refreshAllowance() {
  await window.biismoAuth.ready;
  if (!window.biismoAuth.getUser()) {
    renderAllowance(null);
    return;
  }

  try {
    const response = await window.biismoAuth.authorizedFetch("/api/allowance", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Allowance unavailable.");
    renderAllowance(data);
  } catch {
    allowanceText.textContent = "Daily allowance temporarily unavailable";
  }
}

function setLoading(visible) {
  loadingOverlay.classList.toggle("is-visible", visible);
  loadingOverlay.setAttribute("aria-hidden", String(!visible));
  document.body.classList.toggle("is-loading", visible);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayValue(value, suffix = "") {
  if (value === null || value === undefined || value === "" || value === "Unknown") {
    return "N/A";
  }

  return `${escapeHtml(value)}${suffix}`;
}

function normalizeRegistration(value) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

function isValidRegistration(registration) {
  return (
    /^[A-Z0-9]{2,8}$/.test(registration) &&
    /[A-Z]/.test(registration) &&
    /[0-9]/.test(registration)
  );
}

function formatDate(dateValue) {
  if (!dateValue) return "N/A";
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleDateString("en-GB");
}

function daysUntil(dateValue) {
  const target = new Date(dateValue);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function dateStatus(dateValue, activeLabel, expiredLabel) {
  const days = daysUntil(dateValue);

  if (days === null) {
    return { date: "N/A", text: "Status unavailable", className: "tax-amber" };
  }

  if (days < 0) {
    return { date: formatDate(dateValue), text: expiredLabel, className: "tax-red" };
  }

  const remaining = days === 0 ? "due today" : `${days} days left`;
  return {
    date: formatDate(dateValue),
    text: `${activeLabel} • ${remaining}`,
    className: days <= 30 ? "tax-amber" : "tax-green",
  };
}

function getMotStatus(vehicle) {
  if (vehicle.motExpiryDate) {
    return dateStatus(vehicle.motExpiryDate, "Valid", "Expired");
  }

  if (vehicle.monthOfFirstRegistration) {
    const firstRegistration = new Date(`${vehicle.monthOfFirstRegistration}-01`);
    if (!Number.isNaN(firstRegistration.getTime())) {
      const firstMotDate = new Date(firstRegistration);
      firstMotDate.setFullYear(firstMotDate.getFullYear() + 3);
      if (firstMotDate > new Date()) {
        return {
          date: firstMotDate.toLocaleDateString("en-GB"),
          text: "First MOT normally due by this date",
          className: "tax-green",
        };
      }
    }
  }

  const officialStatus = String(vehicle.motStatus || "").toLowerCase();
  if (officialStatus.includes("not valid") || officialStatus.includes("expired")) {
    return { date: "N/A", text: "Not valid", className: "tax-red" };
  }

  return { date: "N/A", text: "Status unavailable", className: "tax-amber" };
}

function getTaxStatus(vehicle) {
  const officialStatus = String(vehicle.taxStatus || "Unknown");
  const normalizedStatus = officialStatus.toLowerCase();

  if (normalizedStatus === "taxed" && vehicle.taxDueDate) {
    return dateStatus(vehicle.taxDueDate, "Taxed", "Tax expired");
  }

  if (normalizedStatus.includes("sorn")) {
    return { date: "N/A", text: officialStatus, className: "tax-amber" };
  }

  if (normalizedStatus.includes("untaxed") || normalizedStatus.includes("expired")) {
    return { date: formatDate(vehicle.taxDueDate), text: officialStatus, className: "tax-red" };
  }

  return {
    date: formatDate(vehicle.taxDueDate),
    text: officialStatus,
    className: "tax-amber",
  };
}

function getMileageInsights(history) {
  const readings = (history || [])
    .map((test) => ({
      date: new Date(test.completedDate),
      mileage: Number.parseInt(String(test.mileage ?? "").replace(/[^\d]/g, ""), 10),
    }))
    .filter((reading) => !Number.isNaN(reading.date.getTime()) && Number.isFinite(reading.mileage))
    .sort((a, b) => a.date - b.date);

  const warnings = [];
  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];

    if (current.mileage < previous.mileage) {
      warnings.push(
        `Recorded mileage fell from ${previous.mileage.toLocaleString()} to ${current.mileage.toLocaleString()} miles.`
      );
    }
  }

  const first = readings[0];
  const latest = readings.at(-1);
  let averageAnnualMileage = null;

  if (first && latest && first !== latest && latest.mileage >= first.mileage) {
    const years = (latest.date - first.date) / 31_557_600_000;
    if (years > 0) {
      averageAnnualMileage = Math.round((latest.mileage - first.mileage) / years);
    }
  }

  return {
    warnings: [...new Set(warnings)],
    latestMileage: latest?.mileage ?? null,
    averageAnnualMileage,
  };
}

function estimateUlez(vehicle) {
  if (String(vehicle.fuelType).toLowerCase().includes("electric")) {
    return "Likely compliant";
  }

  const euroNumber = Number.parseInt(String(vehicle.euroStatus).replace(/\D/g, ""), 10);
  if (!Number.isFinite(euroNumber)) return "Unknown";

  const fuel = String(vehicle.fuelType).toLowerCase();
  if (fuel.includes("petrol")) return euroNumber >= 4 ? "Likely compliant" : "Likely non-compliant";
  if (fuel.includes("diesel")) return euroNumber >= 6 ? "Likely compliant" : "Likely non-compliant";

  return "Unknown";
}

function buildDefects(defects) {
  if (!Array.isArray(defects) || defects.length === 0) {
    return '<div class="clean-pass">No advisories or defects recorded</div>';
  }

  const groups = { DANGEROUS: [], MAJOR: [], MINOR: [], ADVISORY: [] };

  for (const defect of defects) {
    const type = String(defect.type || "ADVISORY").toUpperCase();
    const group = groups[type] || groups.ADVISORY;
    group.push(defect.text || "Issue found");
  }

  return Object.entries(groups)
    .map(([type, items]) => {
      if (items.length === 0) return "";
      return `
        <div class="defect-group ${type.toLowerCase()}">
          <b>${type}</b>
          ${items.map((item) => `<div class="defect-item">${escapeHtml(item)}</div>`).join("")}
        </div>
      `;
    })
    .join("");
}

function vehicleAge(vehicle) {
  const year = Number.parseInt(vehicle.year, 10);
  return Number.isFinite(year) ? Math.max(new Date().getFullYear() - year, 0) : null;
}

function renderVehicle(vehicle) {
  const mot = getMotStatus(vehicle);
  const tax = getTaxStatus(vehicle);
  const mileage = getMileageInsights(vehicle.motHistory);
  const ulezEstimate = estimateUlez(vehicle);
  const motHistory = [...(vehicle.motHistory || [])].sort(
    (a, b) => new Date(b.completedDate) - new Date(a.completedDate)
  );

  result.innerHTML = `
    <section class="result-card">
      <div class="result-heading">
        <div>
          <span class="eyebrow">VEHICLE REPORT</span>
          <h2 class="car-title">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</h2>
        </div>
        <div class="result-plate">
          <div class="gb" aria-hidden="true">GB</div>
          <div class="result-reg">${escapeHtml(vehicle.registration)}</div>
        </div>
      </div>

      <div class="vehicle-grid primary-grid">
        <div class="info-box">
          <div class="info-title">MOT</div>
          <div class="info-value">${escapeHtml(mot.date)}</div>
          <div class="${mot.className}">${escapeHtml(mot.text)}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Tax</div>
          <div class="info-value">${escapeHtml(tax.date)}</div>
          <div class="${tax.className}">${escapeHtml(tax.text)}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Engine</div>
          <div class="info-value">${displayValue(vehicle.engineCapacity, vehicle.engineCapacity ? "cc" : "")}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Fuel</div>
          <div class="info-value">${displayValue(vehicle.fuelType)}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Average annual mileage</div>
          <div class="info-value">${mileage.averageAnnualMileage === null ? "N/A" : `${mileage.averageAnnualMileage.toLocaleString()} mi`}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Last recorded mileage</div>
          <div class="info-value">${mileage.latestMileage === null ? "N/A" : `${mileage.latestMileage.toLocaleString()} mi`}</div>
        </div>
        <div class="info-box">
          <div class="info-title">Vehicle age</div>
          <div class="info-value">${vehicleAge(vehicle) === null ? "N/A" : `${vehicleAge(vehicle)} yrs`}</div>
        </div>
        <div class="info-box calculated-field">
          <div class="info-title">ULEZ estimate</div>
          <div class="info-value">${escapeHtml(ulezEstimate)}</div>
        </div>
      </div>

      <div class="vehicle-grid detail-grid">
        <div class="info-box"><div class="info-title">Colour</div><div class="info-value">${displayValue(vehicle.colour)}</div></div>
        <div class="info-box"><div class="info-title">CO₂ emissions</div><div class="info-value">${displayValue(vehicle.co2Emissions)}</div></div>
        <div class="info-box"><div class="info-title">Euro status</div><div class="info-value">${displayValue(vehicle.euroStatus)}</div></div>
        <div class="info-box"><div class="info-title">RDE</div><div class="info-value">${displayValue(vehicle.realDrivingEmissions)}</div></div>
        <div class="info-box"><div class="info-title">Type approval</div><div class="info-value">${displayValue(vehicle.typeApproval)}</div></div>
        <div class="info-box"><div class="info-title">Wheelplan</div><div class="info-value">${displayValue(vehicle.wheelplan)}</div></div>
        <div class="info-box"><div class="info-title">Revenue weight</div><div class="info-value">${displayValue(vehicle.revenueWeight, vehicle.revenueWeight ? " kg" : "")}</div></div>
        <div class="info-box"><div class="info-title">First registered</div><div class="info-value">${displayValue(vehicle.monthOfFirstRegistration)}</div></div>
        <div class="info-box"><div class="info-title">V5C issued</div><div class="info-value">${escapeHtml(formatDate(vehicle.dateOfLastV5CIssued))}</div></div>
        <div class="info-box"><div class="info-title">Export marker</div><div class="info-value">${vehicle.exportMarker ? "Yes" : "No"}</div></div>
      </div>

      <p class="derived-notice">
        ULEZ and mileage insights are estimates based on the supplied vehicle records. Confirm ULEZ status with Transport for London before travelling.
      </p>

      ${
        mileage.warnings.length
          ? `<div class="mileage-warning">⚠️ ${mileage.warnings.map(escapeHtml).join("<br>")}</div>`
          : ""
      }

      <div class="actions-row">
        <button id="saveVehicleButton" class="primary-button" type="button">Save to garage</button>
        <button id="motButton" class="secondary-button" type="button">Show MOT history</button>
        <button class="secondary-button print-only" type="button" id="printButton">Print report</button>
      </div>

      <div id="motContainer">
        ${
          motHistory.length
            ? motHistory
                .map(
                  (test) => `
                    <div class="mot-card">
                      <div class="${test.result === "PASSED" ? "pass" : "fail"}">${escapeHtml(test.result)}</div>
                      <div>${escapeHtml(formatDate(test.completedDate))}</div>
                      <div>${displayValue(test.mileage, test.mileage ? ` ${escapeHtml(test.mileageUnit || "mi")}` : "")}</div>
                      ${buildDefects(test.defects)}
                    </div>
                  `
                )
                .join("")
            : '<div class="mot-card">No MOT history found</div>'
        }
      </div>
    </section>
  `;

  const motContainer = document.getElementById("motContainer");
  const motButton = document.getElementById("motButton");
  motButton.addEventListener("click", () => {
    const isOpen = motContainer.classList.toggle("is-open");
    motButton.textContent = isOpen ? "Hide MOT history" : "Show MOT history";
  });
  document.getElementById("printButton").addEventListener("click", () => window.print());

  const saveButton = document.getElementById("saveVehicleButton");
  window.biismoAuth.ready.then(() => {
    if (!window.biismoAuth.getUser()) saveButton.textContent = "Sign in to save";
  });
  saveButton.addEventListener("click", async () => {
    await window.biismoAuth.ready;
    if (!window.biismoAuth.getUser()) {
      window.biismoAuth.openAuthDialog("signin");
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      await window.biismoAuth.saveVehicle(vehicle);
      saveButton.textContent = "Saved to garage ✓";
      saveButton.classList.add("is-saved");
    } catch (error) {
      saveButton.textContent = "Try saving again";
      formError.textContent = error.message || "The vehicle could not be saved.";
      saveButton.disabled = false;
    }
  });
}

async function checkVehicle(event) {
  event.preventDefault();
  formError.textContent = "";

  const registration = normalizeRegistration(regInput.value.trim());
  if (!isValidRegistration(registration)) {
    formError.textContent = "Enter a valid UK registration number.";
    regInput.focus();
    return;
  }

  await window.biismoAuth.ready;
  if (!window.biismoAuth.getUser()) {
    formError.textContent = "Sign in to use your 5 free daily vehicle checks.";
    window.biismoAuth.openAuthDialog("signin");
    return;
  }

  searchButton.disabled = true;
  searchButton.textContent = "Checking…";
  setLoading(true);

  try {
    const response = await window.biismoAuth.authorizedFetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNumber: registration }),
    });
    const data = await response.json();

    if (!response.ok) {
      if (data.allowance) renderAllowance(data.allowance);
      throw new Error(data.error || "Vehicle check failed. Please try again.");
    }

    renderAllowance(data.allowance);
    renderVehicle(data);
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    result.innerHTML = `
      <div class="result-card error-state">
        <strong>We couldn't complete that check.</strong>
        <p>${escapeHtml(error.message || "Please try again shortly.")}</p>
      </div>
    `;
  } finally {
    setLoading(false);
    searchButton.disabled = false;
    searchButton.textContent = "Check vehicle →";
  }
}

vehicleForm.addEventListener("submit", checkVehicle);

window.biismoAuth.ready.then(refreshAllowance);
window.addEventListener("biismo-auth-change", refreshAllowance);

const requestedRegistration = new URLSearchParams(window.location.search).get("reg");
if (requestedRegistration) {
  regInput.value = requestedRegistration;
  vehicleForm.requestSubmit();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The vehicle checker still works if offline support cannot be registered.
    });
  });
}
