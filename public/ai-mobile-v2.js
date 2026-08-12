(() => {
  if (window.location.pathname !== '/ai-mechanic.html') return;

  const isMobile = () => window.matchMedia('(max-width: 850px)').matches;

  function installComposerPolish() {
    const input = document.getElementById('chatInput');
    if (input) {
      input.placeholder = 'Ask Check A Reg AI';
      input.rows = 2;
    }

    const compose = document.querySelector('.ai-chat-compose');
    const preview = document.getElementById('chatPhotoPreview');
    const textarea = document.getElementById('chatInput');
    if (compose && preview && textarea && preview.parentElement !== compose) {
      compose.insertBefore(preview, textarea);
    }
  }

  function installMobileNewChat() {
    const newCaseView = document.getElementById('newCaseView');
    const chatView = document.getElementById('chatView');
    const chatMessages = document.getElementById('chatMessages');
    const chatTitle = document.getElementById('chatTitle');
    const chatVehicle = document.getElementById('chatVehicle');
    const chatInput = document.getElementById('chatInput');
    const send = document.getElementById('sendChatButton');
    const chatStatus = document.getElementById('chatStatus');
    const vehicleSelect = document.getElementById('vehicleSelect');
    const issueText = document.getElementById('issueText');
    const newCase = document.getElementById('newCaseButton');
    const backToNew = document.getElementById('backToNewButton');
    const caseList = document.getElementById('caseList');
    const workspace = document.getElementById('aiWorkspace');
    const chatTop = document.querySelector('.ai-chat-top > div');
    if (!newCaseView || !chatView || !chatMessages || !chatInput || !send || !vehicleSelect || !issueText || !chatTop) return;

    let mobileVehicle = document.getElementById('mobileDraftVehicleSelect');
    if (!mobileVehicle) {
      mobileVehicle = document.createElement('select');
      mobileVehicle.id = 'mobileDraftVehicleSelect';
      mobileVehicle.className = 'ai-mobile-draft-vehicle';
      mobileVehicle.setAttribute('aria-label', 'Vehicle for this new chat');
      chatTop.append(mobileVehicle);
    }

    const syncVehicles = () => {
      const oldValue = mobileVehicle.value;
      mobileVehicle.innerHTML = vehicleSelect.innerHTML;
      if (oldValue && [...mobileVehicle.options].some(option => option.value === oldValue)) mobileVehicle.value = oldValue;
      else if (vehicleSelect.value) mobileVehicle.value = vehicleSelect.value;
      else {
        const firstVehicle = [...mobileVehicle.options].find(option => option.value);
        if (firstVehicle) mobileVehicle.value = firstVehicle.value;
      }
    };
    syncVehicles();
    new MutationObserver(syncVehicles).observe(vehicleSelect, { childList:true, subtree:true });

    const enterDraft = () => {
      if (!isMobile()) return;
      currentCaseId = null;
      document.body.classList.add('ai-mobile-new-chat');
      newCaseView.hidden = true;
      chatView.hidden = false;
      chatMessages.innerHTML = '';
      chatTitle.textContent = 'New chat';
      chatVehicle.textContent = 'CHECK A REG AI';
      chatStatus.textContent = aiQuestions > 0 ? `${aiQuestions} AI ${aiQuestions === 1 ? 'question' : 'questions'} available.` : 'No AI questions left.';
      syncVehicles();
      chatInput.value = '';
      chatInput.style.height = '';
      window.scrollTo({ top:0, behavior:'smooth' });
    };

    const exitDraft = () => document.body.classList.remove('ai-mobile-new-chat');

    const startDraft = async () => {
      if (!isMobile() || !document.body.classList.contains('ai-mobile-new-chat') || currentCaseId) return;
      const text = chatInput.value.trim();
      if (!text && !chatPhotos.length) return;
      vehicleSelect.value = mobileVehicle.value;
      issueText.value = text;
      newPhotos = [...chatPhotos];
      chatStatus.textContent = 'Check A Reg AI is thinking…';
      await startDiagnosis();
      if (currentCaseId) {
        exitDraft();
        chatInput.value = '';
        chatInput.style.height = '';
        chatPhotos = [];
        renderPhotos(document.getElementById('chatPhotoPreview'), chatPhotos, 'chat');
      } else {
        chatStatus.innerHTML = aiStatus.innerHTML || aiStatus.textContent || 'Could not start this chat.';
      }
    };

    newCase?.addEventListener('click', () => setTimeout(enterDraft, 0));
    backToNew?.addEventListener('click', () => setTimeout(enterDraft, 0));
    caseList?.addEventListener('click', event => {
      if (event.target.closest('[data-case-id]')) exitDraft();
    }, true);

    send.addEventListener('click', () => {
      if (document.body.classList.contains('ai-mobile-new-chat') && !currentCaseId) void startDraft();
    });
    chatInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && document.body.classList.contains('ai-mobile-new-chat') && !currentCaseId) {
        event.preventDefault();
        void startDraft();
      }
    });

    const syncInitialView = () => {
      if (isMobile() && workspace && !workspace.hidden && !currentCaseId && !document.body.classList.contains('ai-mobile-new-chat')) enterDraft();
    };
    syncInitialView();
    if (workspace) new MutationObserver(syncInitialView).observe(workspace, { attributes:true, attributeFilter:['hidden'] });

    window.matchMedia('(max-width: 850px)').addEventListener?.('change', event => {
      if (event.matches && !currentCaseId) enterDraft();
      if (!event.matches && document.body.classList.contains('ai-mobile-new-chat')) {
        exitDraft();
        chatView.hidden = true;
        newCaseView.hidden = false;
      }
    });
  }

  function initMobileChatShell() {
    installComposerPolish();
    installMobileNewChat();
    const header = document.querySelector('.ai-header');
    const sidebar = document.querySelector('.ai-sidebar');
    const caseList = document.getElementById('caseList');
    const newCase = document.getElementById('newCaseButton');
    const chatView = document.getElementById('chatView');
    if (!header || !sidebar) return;

    let chatsButton = document.getElementById('mobileChatsButton');
    if (!chatsButton) {
      chatsButton = document.createElement('button');
      chatsButton.id = 'mobileChatsButton';
      chatsButton.className = 'ai-mobile-chats-button';
      chatsButton.type = 'button';
      chatsButton.setAttribute('aria-label', 'Open previous chats');
      chatsButton.setAttribute('aria-expanded', 'false');
      chatsButton.innerHTML = '<span aria-hidden="true">☰</span><span>Chats</span>';
      const actions = header.querySelector('.ai-header-actions');
      header.insertBefore(chatsButton, actions || null);
    }

    let closeButton = document.getElementById('mobileDrawerClose');
    if (!closeButton) {
      closeButton = document.createElement('button');
      closeButton.id = 'mobileDrawerClose';
      closeButton.className = 'ai-mobile-drawer-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close chats');
      closeButton.textContent = '×';
      sidebar.append(closeButton);
    }

    let backdrop = document.getElementById('mobileDrawerBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'mobileDrawerBackdrop';
      backdrop.className = 'ai-mobile-drawer-backdrop';
      document.body.append(backdrop);
    }

    const openDrawer = () => {
      document.body.classList.add('ai-chat-drawer-open');
      chatsButton.setAttribute('aria-expanded', 'true');
    };
    const closeDrawer = () => {
      document.body.classList.remove('ai-chat-drawer-open');
      chatsButton.setAttribute('aria-expanded', 'false');
    };

    chatsButton.addEventListener('click', () => {
      document.body.classList.contains('ai-chat-drawer-open') ? closeDrawer() : openDrawer();
    });
    closeButton.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    newCase?.addEventListener('click', closeDrawer);

    caseList?.addEventListener('click', (event) => {
      if (!event.target.closest('[data-case-id]')) return;
      closeDrawer();
      window.setTimeout(() => {
        document.getElementById('chatView')?.scrollIntoView({ block: 'start' });
      }, 180);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });

    const syncChatState = () => {
      document.body.classList.toggle('ai-chat-active', Boolean(chatView && !chatView.hidden));
    };
    syncChatState();
    if (chatView) new MutationObserver(syncChatState).observe(chatView, { attributes: true, attributeFilter: ['hidden'] });

    const media = window.matchMedia('(min-width: 851px)');
    const clearDesktopDrawer = () => { if (media.matches) closeDrawer(); };
    media.addEventListener?.('change', clearDesktopDrawer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMobileChatShell, { once: true });
  else initMobileChatShell();
})();
