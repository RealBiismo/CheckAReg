(() => {
  if (window.location.pathname !== '/ai-mechanic.html') return;

  const aiStatus = document.getElementById('aiStatus');
  const chatStatus = document.getElementById('chatStatus');
  const chatView = document.getElementById('chatView');
  const chatMessages = document.getElementById('chatMessages');

  if (!chatMessages) return;

  function isThinkingText(node) {
    return /biismo ai is thinking/i.test(String(node?.textContent || ''));
  }

  function removeInlineThinking() {
    chatMessages.querySelector('.ai-inline-thinking')?.remove();
  }

  function sync() {
    const thinking = isThinkingText(aiStatus) || isThinkingText(chatStatus);
    const visibleChat = chatView && !chatView.hidden;

    if (!thinking || !visibleChat) {
      removeInlineThinking();
      return;
    }

    if (chatMessages.querySelector('.is-thinking')) return;

    try {
      const firstAssistant = !chatMessages.querySelector('.ai-message.is-assistant');
      const node = appendThinking(firstAssistant);
      node?.classList.add('ai-inline-thinking');
    } catch {}
  }

  [aiStatus, chatStatus].forEach((node) => {
    if (node) new MutationObserver(sync).observe(node, { childList:true, subtree:true, characterData:true });
  });

  if (chatView) new MutationObserver(sync).observe(chatView, { attributes:true, attributeFilter:['hidden'] });

  new MutationObserver(() => {
    const inline = chatMessages.querySelector('.ai-inline-thinking');
    if (!inline) return;
    const completedAssistant = [...chatMessages.querySelectorAll('.ai-message.is-assistant')]
      .some((node) => !node.classList.contains('is-thinking'));
    if (completedAssistant && !isThinkingText(aiStatus) && !isThinkingText(chatStatus)) inline.remove();
  }).observe(chatMessages, { childList:true });

  sync();
})();
