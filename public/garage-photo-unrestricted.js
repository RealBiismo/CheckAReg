(() => {
  const grid = document.getElementById("savedVehicles");
  if (!grid) return;

  const helperText = "Choose any photo from your device";

  function apply(card) {
    const input = card.querySelector("[data-photo-input]");
    if (input) {
      if (input.accept !== "image/*") input.accept = "image/*";
      if (input.hasAttribute("capture")) input.removeAttribute("capture");
    }

    const small = card.querySelector("[data-photo-placeholder] small");
    if (small && small.textContent !== helperText) {
      small.textContent = helperText;
    }
  }

  const applyAll = () => grid.querySelectorAll(".garage-card").forEach(apply);
  applyAll();

  // Ownership controls can be inserted after the base card renders, so watch the
  // subtree, but only write when a value actually differs. This prevents the
  // observer from triggering itself continuously on Safari/iOS.
  new MutationObserver(applyAll).observe(grid, { childList: true, subtree: true });
})();
