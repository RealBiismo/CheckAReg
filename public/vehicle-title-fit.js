(() => {
  const result = document.getElementById("result");
  if (!result) return;

  function applyTitleSize() {
    const title = result.querySelector(".vehicle-title-row .car-title, .car-title");
    if (!title) return;

    const text = String(title.textContent || "").trim();
    title.classList.remove("is-long-title", "is-very-long-title");

    if (text.length >= 19) {
      title.classList.add("is-very-long-title");
    } else if (text.length >= 15) {
      title.classList.add("is-long-title");
    }
  }

  const schedule = () => requestAnimationFrame(() => requestAnimationFrame(applyTitleSize));
  const observer = new MutationObserver(schedule);
  observer.observe(result, { childList: true, subtree: true, characterData: true });

  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  document.fonts?.ready?.then(schedule);
  schedule();
})();
