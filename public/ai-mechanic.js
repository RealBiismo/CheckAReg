const signedOut = document.getElementById('aiSignedOut');
const unavailable = document.getElementById('aiUnavailable');
const unavailableText = document.getElementById('aiUnavailableText');
const workspace = document.getElementById('aiWorkspace');
const vehicleSelect = document.getElementById('vehicleSelect');
const issueText = document.getElementById('issueText');
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const startButton = document.getElementById('startDiagnosisButton');
const aiStatus = document.getElementById('aiStatus');
const creditBadge = document.getElementById('creditBadge');
const categoryGrid = document.getElementById('categoryGrid');
const caseList = document.getElementById('caseList');
const newCaseButton = document.getElementById('newCaseButton');
const refreshCasesButton = document.getElementById('refreshCasesButton');
const newCaseView = document.getElementById('newCaseView');
const chatView = document.getElementById('chatView');
const chatMessages = document.getElementById('chatMessages');
const chatVehicle = document.getElementById('chatVehicle');
const chatTitle = document.getElementById('chatTitle');
const chatInput = document.getElementById('chatInput');
const chatPhotoInput = document.getElementById('chatPhotoInput');
const chatPhotoPreview = document.getElementById('chatPhotoPreview');
const sendChatButton = document.getElementById('sendChatButton');
const chatStatus = document.getElementById('chatStatus');
const backToNewButton = document.getElementById('backToNewButton');

let selectedCategory = 'Other';
let newPhotos = [];
let chatPhotos = [];
let currentCaseId = null;
let vehicles = [];
let aiEnabled = false;
let aiQuestions = 0;
let requestInFlight = false;
const AI_REQUEST_TIMEOUT_MS = 45_000;

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function formatMessageTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(date);
}

function setBusy(busy) {
  requestInFlight = busy;
  document.body.classList.toggle('ai-loading', busy);
  startButton.disabled = busy || aiQuestions < 1 || !vehicles.length;
  sendChatButton.disabled = busy || aiQuestions < 1;
}

async function invoke(body) {
  const client = window.biismoAuth.getClient();
  let timeoutId;
  const request = client.functions.invoke('ai-mechanic', { body });
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Check A Reg AI took too long to respond. Your controls have been unlocked — please retry.'));
    }, AI_REQUEST_TIMEOUT_MS);
  });
  let result;
  try {
    result = await Promise.race([request, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
  const { data, error } = result;
  if (error) {
    let message = error.message || 'Check A Reg AI could not be reached.';
    try {
      const context = await error.context?.json?.();
      if (context?.error) message = context.error;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function renderQuestionBalance(value) {
  aiQuestions = Math.max(0, Number(value) || 0);
  creditBadge.textContent = `${aiQuestions} AI ${aiQuestions === 1 ? 'question' : 'questions'}`;
  startButton.disabled = requestInFlight || aiQuestions < 1 || !vehicles.length;
  sendChatButton.disabled = requestInFlight || aiQuestions < 1;
}

async function loadAllowance() {
  try {
    const response = await window.biismoAuth.authorizedFetch('/api/plus/status', { cache:'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI question balance could not be loaded.');
    renderQuestionBalance(data.aiQuestions);
  } catch {
    creditBadge.textContent = 'Questions unavailable';
  }
}

async function loadVehicles() {
  vehicles = await window.biismoAuth.listSavedVehicles();
  if (!vehicles.length) {
    vehicleSelect.innerHTML = '<option value="">No saved vehicles yet</option>';
    startButton.disabled = true;
    aiStatus.innerHTML = 'Save a vehicle to <a href="/account.html">My Garage</a> before starting a diagnosis.';
    return;
  }
  vehicleSelect.innerHTML = '<option value="">Choose a saved vehicle</option>' + vehicles.map(v => {
    const name = [v.make,v.model].filter(Boolean).join(' ');
    return `<option value="${escapeHtml(v.id)}">${escapeHtml(v.registration)} · ${escapeHtml(name || 'Saved vehicle')}</option>`;
  }).join('');
  startButton.disabled = requestInFlight || aiQuestions < 1;
}

function loadImage(url) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be decoded.'));
    image.src = url;
  });
}

async function fileToPreparedDataUrl(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (!file || (!type.startsWith('image/') && !/\.(heic|heif|jpg|jpeg|png|webp|gif)$/i.test(name))) {
    throw new Error('Choose a photo from your device.');
  }

  const url = URL.createObjectURL(file);
  try {
    let image;
    try {
      image = await loadImage(url);
    } catch {
      const raw = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Photo could not be read.'));
        reader.readAsDataURL(file);
      });
      image = await loadImage(raw);
    }

    const maxSide = 1440;
    const sourceWidth = image.naturalWidth || image.width || 1;
    const sourceHeight = image.naturalHeight || image.height || 1;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha:false });
    if (!ctx) throw new Error('Photo processing is unavailable on this device.');
    ctx.drawImage(image, 0, 0, width, height);

    let quality = .82;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 2_200_000 && quality > .46) {
      quality -= .08;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    if (!data.startsWith('data:image/jpeg;base64,') || data.length > 2_500_000) {
      throw new Error('That photo is too large to attach. Try a smaller image.');
    }
    return data;
  } catch (error) {
    if (/heic|heif/i.test(type + name)) throw new Error('That iPhone photo could not be converted. Try taking a screenshot of it and attach the screenshot.');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderPhotos(container, photos, target) {
  if (!container) return;
  container.hidden = photos.length === 0;
  container.innerHTML = photos.map((photo,index) => `
    <div class="ai-photo-chip ai-photo-chip-confirmed">
      <img src="${photo}" alt="Attached vehicle photo">
      <span class="ai-photo-attached-badge">Attached</span>
      <button type="button" data-remove-photo="${index}" aria-label="Remove attached photo">×</button>
    </div>`).join('');
  container.querySelectorAll('[data-remove-photo]').forEach(button => button.addEventListener('click', () => {
    const list = target === 'new' ? newPhotos : chatPhotos;
    list.splice(Number(button.dataset.removePhoto), 1);
    renderPhotos(container, list, target);
    const status = target === 'new' ? aiStatus : chatStatus;
    if (status) status.textContent = list.length ? `${list.length} photo${list.length === 1 ? '' : 's'} attached` : '';
  }));
}

async function addFiles(fileList, target) {
  const list = target === 'new' ? newPhotos : chatPhotos;
  const remaining = Math.max(0, 3 - list.length);
  const files = [...(fileList || [])].slice(0, remaining);
  if (!files.length) {
    if (list.length >= 3) throw new Error('Up to 3 photos can be attached.');
    return;
  }
  const status = target === 'new' ? aiStatus : chatStatus;
  if (status) status.textContent = 'Attaching photo…';
  for (const file of files) list.push(await fileToPreparedDataUrl(file));
  renderPhotos(target === 'new' ? photoPreview : chatPhotoPreview, list, target);
  if (status) status.textContent = `${list.length} photo${list.length === 1 ? '' : 's'} attached`;
}

function attachmentMarkup(count) {
  const n = Number(count) || 0;
  return n ? `<div class="ai-message-attachment">📎 ${n} photo${n === 1 ? '' : 's'} attached</div>` : '';
}

function messageHtml(message, assistantIndex) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const showAssistantLabel = role === 'assistant' && assistantIndex === 0;
  const label = role === 'user' ? '<small class="ai-message-label">You</small>' : showAssistantLabel ? '<small class="ai-message-label">Check A Reg AI</small>' : '';
  const timestamp = formatMessageTime(message.createdAt);
  return `<div class="ai-message is-${role}">${label}${attachmentMarkup(message.imageCount)}<div class="ai-message-copy">${escapeHtml(message.content)}</div>${timestamp ? `<time class="ai-message-time" datetime="${escapeHtml(message.createdAt || '')}">${escapeHtml(timestamp)}</time>` : ''}</div>`;
}

function renderMessages(messages) {
  let assistantIndex = 0;
  chatMessages.innerHTML = (messages || []).map(message => {
    const html = messageHtml(message, assistantIndex);
    if (message.role !== 'user') assistantIndex += 1;
    return html;
  }).join('');
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessage(role, content, createdAt = new Date(), showAssistantLabel = false, imageCount = 0) {
  const div = document.createElement('div');
  div.className = `ai-message ${role === 'user' ? 'is-user' : 'is-assistant'}`;
  const label = role === 'user' ? '<small class="ai-message-label">You</small>' : showAssistantLabel ? '<small class="ai-message-label">Check A Reg AI</small>' : '';
  div.innerHTML = `${label}${attachmentMarkup(imageCount)}<div class="ai-message-copy">${escapeHtml(content)}</div><time class="ai-message-time">${escapeHtml(formatMessageTime(createdAt))}</time>`;
  chatMessages.append(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function appendThinking(showLabel = false) {
  const div = document.createElement('div');
  div.className = 'ai-message is-assistant is-thinking';
  div.innerHTML = `${showLabel ? '<small class="ai-message-label">Check A Reg AI</small>' : ''}<div class="ai-thinking-copy"><span></span><span></span><span></span><em>Check A Reg AI is thinking…</em></div>`;
  chatMessages.append(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function showNewCase() {
  currentCaseId = null;
  newCaseView.hidden = false;
  chatView.hidden = true;
  aiStatus.textContent = '';
  window.scrollTo({ top:0, behavior:'smooth' });
}

async function openCase(caseId) {
  setBusy(true);
  chatStatus.textContent = 'Loading chat…';
  try {
    const data = await invoke({ action:'load', caseId });
    currentCaseId = caseId;
    newCaseView.hidden = true;
    chatView.hidden = false;
    chatVehicle.textContent = `${data.vehicle?.registration || 'VEHICLE'} · ${[data.vehicle?.make,data.vehicle?.model].filter(Boolean).join(' ')}`;
    chatTitle.textContent = data.case?.title || 'Check A Reg AI chat';
    renderMessages(data.messages || []);
    chatStatus.textContent = aiQuestions > 0 ? `${aiQuestions} AI questions available.` : 'No AI questions left. Get more from Plans & credits.';
  } catch (error) {
    aiStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function loadCases() {
  try {
    const data = await invoke({ action:'list' });
    const cases = Array.isArray(data.cases) ? data.cases : [];
    caseList.innerHTML = cases.length ? cases.map(item => `<button class="ai-case" type="button" data-case-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.registration)}</strong><span>${escapeHtml(item.title || item.category)}</span><small>${formatMessageTime(item.updatedAt || item.createdAt)}</small></button>`).join('') : '<p class="ai-muted">No Check A Reg AI chats saved yet.</p>';
    caseList.querySelectorAll('[data-case-id]').forEach(button => button.addEventListener('click', () => openCase(button.dataset.caseId)));
  } catch (error) {
    caseList.innerHTML = `<p class="ai-muted">${escapeHtml(error.message)}</p>`;
  }
}

categoryGrid.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => {
  selectedCategory = button.dataset.category;
  categoryGrid.querySelectorAll('[data-category]').forEach(item => item.classList.toggle('is-selected', item === button));
}));
categoryGrid.querySelector('[data-category="Other"]')?.classList.add('is-selected');

photoInput.addEventListener('change', async () => {
  try { await addFiles(photoInput.files, 'new'); }
  catch (error) { aiStatus.textContent = error.message; }
  finally { photoInput.value = ''; }
});

chatPhotoInput.addEventListener('change', async () => {
  try { await addFiles(chatPhotoInput.files, 'chat'); }
  catch (error) { chatStatus.textContent = error.message; }
  finally { chatPhotoInput.value = ''; }
});

async function startDiagnosis() {
  if (requestInFlight) return;
  const vehicleId = vehicleSelect.value;
  let text = issueText.value.trim();
  if (!text && newPhotos.length) text = 'Please analyse the attached vehicle photo.';
  if (aiQuestions < 1) return aiStatus.innerHTML = 'You have no AI questions left. <a href="/credits.html">Buy credits or upgrade to REG+.</a>';
  if (!vehicleId) return aiStatus.textContent = 'Choose a vehicle from your Garage.';
  if (text.length < 3) return aiStatus.textContent = 'Describe what is happening with the car or attach a photo.';

  const photosForRequest = [...newPhotos];
  setBusy(true);
  aiStatus.textContent = 'Check A Reg AI is thinking…';
  try {
    const data = await invoke({ action:'start', vehicleId, category:selectedCategory, text, images:photosForRequest });
    currentCaseId = data.caseId;
    renderQuestionBalance(data.questionsRemaining);
    newCaseView.hidden = true;
    chatView.hidden = false;
    const vehicle = data.vehicle || vehicles.find(v => v.id === vehicleId) || {};
    chatVehicle.textContent = `${vehicle.registration || ''} · ${[vehicle.make,vehicle.model].filter(Boolean).join(' ')}`;
    chatTitle.textContent = text.slice(0,90);
    chatMessages.innerHTML = '';
    appendMessage('user', text, new Date(), false, photosForRequest.length);
    appendMessage('assistant', data.reply, new Date(), true);
    issueText.value = '';
    newPhotos = [];
    renderPhotos(photoPreview, newPhotos, 'new');
    chatStatus.textContent = `${aiQuestions} AI ${aiQuestions === 1 ? 'question' : 'questions'} remaining.`;
    void loadCases();
  } catch (error) {
    aiStatus.textContent = error.message;
    await loadAllowance();
  } finally {
    setBusy(false);
  }
}

async function sendChatMessage() {
  if (requestInFlight) return;
  let text = chatInput.value.trim();
  if (!text && chatPhotos.length) text = 'Please analyse the attached vehicle photo.';
  if (!currentCaseId || !text) return;
  if (aiQuestions < 1) return chatStatus.innerHTML = 'No AI questions left. <a href="/credits.html">Buy credits or get more AI questions.</a>';

  const photosForRequest = [...chatPhotos];
  const sentAt = new Date();
  const userBubble = appendMessage('user', text, sentAt, false, photosForRequest.length);
  const thinking = appendThinking(false);
  chatStatus.textContent = 'Check A Reg AI is thinking…';
  setBusy(true);

  try {
    const data = await invoke({ action:'message', caseId:currentCaseId, text, images:photosForRequest });
    thinking.remove();
    renderQuestionBalance(data.questionsRemaining);
    appendMessage('assistant', data.reply, new Date(), false);
    chatInput.value = '';
    chatInput.style.height = '';
    chatPhotos = [];
    renderPhotos(chatPhotoPreview, chatPhotos, 'chat');
    chatStatus.textContent = `${aiQuestions} AI ${aiQuestions === 1 ? 'question' : 'questions'} remaining.`;
    void loadCases();
  } catch (error) {
    thinking.remove();
    userBubble.remove();
    chatStatus.textContent = `${error.message} Your text and photo are still ready to retry.`;
    await loadAllowance();
  } finally {
    setBusy(false);
  }
}

startButton.addEventListener('click', startDiagnosis);
sendChatButton.addEventListener('click', sendChatMessage);

function bindEnterToSend(textarea, handler) {
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void handler();
  });
}

bindEnterToSend(issueText, startDiagnosis);
bindEnterToSend(chatInput, sendChatMessage);

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 180)}px`;
});

newCaseButton.addEventListener('click', showNewCase);
backToNewButton.addEventListener('click', showNewCase);
refreshCasesButton.addEventListener('click', loadCases);

function installAttachmentLayout() {
  const wrap = document.querySelector('.ai-chat-compose-wrap');
  const compose = wrap?.querySelector('.ai-chat-compose');
  if (wrap && compose && chatPhotoPreview) wrap.insertBefore(chatPhotoPreview, compose);
  renderPhotos(chatPhotoPreview, chatPhotos, 'chat');
  renderPhotos(photoPreview, newPhotos, 'new');
}

(async function init() {
  installAttachmentLayout();
  await window.biismoAuth.ready;
  const user = window.biismoAuth.getUser();
  if (!user) { signedOut.hidden = false; return; }

  try {
    const status = await invoke({ action:'status' });
    aiEnabled = Boolean(status.enabled);
    if (!aiEnabled) {
      unavailable.hidden = false;
      unavailableText.textContent = 'Check A Reg AI is built and ready. Add the OpenAI API key to activate live diagnoses and photo analysis.';
      return;
    }
    workspace.hidden = false;
    await loadAllowance();
    await Promise.all([loadVehicles(), loadCases()]);
    if (aiQuestions < 1) aiStatus.innerHTML = 'You have no AI questions yet. <a href="/credits.html">Buy credits, unlock questions or get CHECK A REG+.</a>';
  } catch (error) {
    unavailable.hidden = false;
    unavailableText.textContent = error.message || 'Check A Reg AI could not be loaded.';
  }
})();
