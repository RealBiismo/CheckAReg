(() => {
  if (window.location.pathname !== '/ai-mechanic.html') return;

  const GENERIC_VEHICLE_ID = '00000000-0000-0000-0000-000000000000';

  function setGenericVehicleSelect(select) {
    if (!select) return;
    if (select.options.length !== 1 || select.options[0]?.value !== GENERIC_VEHICLE_ID) {
      select.innerHTML = `<option value="${GENERIC_VEHICLE_ID}" selected>Check A Reg AI</option>`;
    }
    if (select.value !== GENERIC_VEHICLE_ID) select.value = GENERIC_VEHICLE_ID;
    select.classList.add('ai-standalone-hidden');
  }

  function installStandaloneMode() {
    try {
      if (!Array.isArray(vehicles) || vehicles.length !== 1 || vehicles[0]?.id !== GENERIC_VEHICLE_ID) {
        vehicles = [{ id: GENERIC_VEHICLE_ID, registration: 'CHECK A REG AI', make: '', model: '' }];
      }
      selectedCategory = 'General vehicle question';
    } catch {}

    setGenericVehicleSelect(document.getElementById('vehicleSelect'));
    setGenericVehicleSelect(document.getElementById('mobileDraftVehicleSelect'));
    document.querySelector('.ai-category-fieldset')?.classList.add('ai-standalone-hidden');
    document.querySelector('label[for="vehicleSelect"]')?.classList.add('ai-standalone-hidden');
  }

  try {
    loadVehicles = async function standaloneVehicleLoader() {
      vehicles = [{ id: GENERIC_VEHICLE_ID, registration: 'CHECK A REG AI', make: '', model: '' }];
      setGenericVehicleSelect(vehicleSelect);
      if (startButton) startButton.disabled = requestInFlight || aiQuestions < 1;
    };
  } catch {}

  function syncChatHeader() {
    const title = document.getElementById('chatTitle');
    const vehicle = document.getElementById('chatVehicle');
    const remove = document.getElementById('removeAiChatButton');
    const isDraft = document.body.classList.contains('ai-mobile-new-chat') || !currentCaseId;
    if (isDraft) {
      if (vehicle && vehicle.textContent !== 'CHECK A REG AI') vehicle.textContent = 'CHECK A REG AI';
      if (title && document.body.classList.contains('ai-mobile-new-chat') && title.textContent !== 'New chat') title.textContent = 'New chat';
      if (remove && !remove.hidden) remove.hidden = true;
    } else if (remove?.hidden) {
      remove.hidden = false;
    }
  }

  let scheduled = false;
  const sync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      installStandaloneMode();
      syncChatHeader();
    });
  };

  function init() {
    sync();
    new MutationObserver(sync).observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class','hidden']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
