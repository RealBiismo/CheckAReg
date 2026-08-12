(() => {
  if (window.location.pathname !== '/ai-mechanic.html') return;

  // The viewport meta tag already disables normal pinch zoom. On iOS Safari,
  // gesture events can still surface, so block only those zoom gestures.
  // Do NOT cancel touchend/click events globally: that can swallow taps and
  // make buttons, textareas and chat controls feel frozen on iPhone.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  });
})();
