(() => {
  if (window.location.pathname !== '/ai-mechanic.html') return;

  const queues = { start: [], message: [] };
  const byId = (id) => document.getElementById(id);

  function targetInfo(input) {
    if (input?.id === 'photoInput') return { key: 'start', preview: byId('photoPreview'), status: byId('aiStatus') };
    return { key: 'message', preview: byId('chatPhotoPreview'), status: byId('chatStatus') };
  }

  function statusText(count) {
    return count ? `${count} photo${count === 1 ? '' : 's'} attached` : '';
  }

  function render(key) {
    const preview = key === 'start' ? byId('photoPreview') : byId('chatPhotoPreview');
    const status = key === 'start' ? byId('aiStatus') : byId('chatStatus');
    if (!preview) return;
    const photos = queues[key];
    preview.innerHTML = photos.map((photo, index) => `
      <div class="ai-photo-chip ai-photo-chip-confirmed">
        <img src="${photo}" alt="Attached vehicle photo">
        <span class="ai-photo-attached-badge">Attached</span>
        <button type="button" data-photo-fix-remove="${index}" aria-label="Remove attached photo">×</button>
      </div>`).join('');
    preview.querySelectorAll('[data-photo-fix-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        photos.splice(Number(button.dataset.photoFixRemove), 1);
        render(key);
      });
    });
    if (status) status.textContent = statusText(photos.length);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  async function fileToJpeg(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose a photo from your device.');
    const url = URL.createObjectURL(file);
    try {
      let image;
      try {
        image = await loadImage(url);
      } catch {
        const raw = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        image = await loadImage(raw);
      }

      const maxSide = 1440;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width || 1, image.naturalHeight || image.height || 1));
      const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Photo processing is not available on this device.');
      context.drawImage(image, 0, 0, width, height);

      let quality = 0.82;
      let data = canvas.toDataURL('image/jpeg', quality);
      while (data.length > 2_200_000 && quality > 0.46) {
        quality -= 0.08;
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (!data.startsWith('data:image/jpeg;base64,') || data.length > 2_500_000) {
        throw new Error('That photo is too large to attach. Try a smaller image.');
      }
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleSelection(input) {
    const { key, status } = targetInfo(input);
    const remaining = Math.max(0, 3 - queues[key].length);
    const files = [...(input.files || [])].slice(0, remaining);
    input.value = '';
    if (!files.length) {
      if (status && queues[key].length >= 3) status.textContent = 'Up to 3 photos can be attached.';
      return;
    }

    if (status) status.textContent = 'Attaching photo…';
    try {
      for (const file of files) queues[key].push(await fileToJpeg(file));
      render(key);
    } catch (error) {
      if (status) status.textContent = error?.message || 'That photo could not be attached.';
    }
  }

  ['photoInput', 'chatPhotoInput'].forEach((id) => {
    const input = byId(id);
    if (!input) return;
    input.addEventListener('change', (event) => {
      event.stopImmediatePropagation();
      void handleSelection(input);
    }, true);
  });

  function ensurePhotoOnlyPrompt(action) {
    if (action === 'start') {
      const input = byId('issueText');
      if (queues.start.length && input && !input.value.trim()) input.value = 'Please analyse the attached vehicle photo.';
    } else {
      const input = byId('chatInput');
      if (queues.message.length && input && !input.value.trim()) input.value = 'Please analyse the attached vehicle photo.';
    }
  }

  byId('startDiagnosisButton')?.addEventListener('click', () => ensurePhotoOnlyPrompt('start'), true);
  byId('sendChatButton')?.addEventListener('click', () => ensurePhotoOnlyPrompt('message'), true);
  byId('chatInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) ensurePhotoOnlyPrompt('message');
  }, true);

  function patchClient() {
    const auth = window.biismoAuth;
    if (!auth?.getClient || auth.__photoFixPatched) return false;
    const originalGetClient = auth.getClient.bind(auth);
    auth.getClient = function patchedGetClient() {
      const client = originalGetClient();
      if (!client?.functions?.invoke || client.functions.__photoFixPatched) return client;
      const originalInvoke = client.functions.invoke.bind(client.functions);
      client.functions.invoke = async function patchedInvoke(name, options = {}) {
        if (name !== 'ai-mechanic' || !options?.body) return originalInvoke(name, options);
        const action = String(options.body.action || '');
        const key = action === 'start' ? 'start' : action === 'message' ? 'message' : null;
        if (!key) return originalInvoke(name, options);

        const images = [...queues[key]];
        const result = await originalInvoke(name, {
          ...options,
          body: { ...options.body, images: images.length ? images : (options.body.images || []) }
        });

        if (!result?.error && !result?.data?.error && images.length) {
          queues[key] = [];
          render(key);
        }
        return result;
      };
      client.functions.__photoFixPatched = true;
      return client;
    };
    auth.__photoFixPatched = true;
    return true;
  }

  const tryPatch = () => {
    if (patchClient()) return;
    setTimeout(tryPatch, 50);
  };
  tryPatch();
})();
