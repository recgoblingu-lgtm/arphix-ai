import { DEFAULT_PERSONALITIES, APP_VERSION, detectIntent, exportConversation, generateOfflineReply, sanitizeText } from './engine.js';
import { generateLocalModelReply } from './local-llm.js';

const STORE_KEY = `arphix-state-${APP_VERSION}`;
const $ = (selector) => document.querySelector(selector);
const elements = {
  agentList: $('#agentList'), activeAvatar: $('#activeAvatar'), activeName: $('#activeName'), activeSubtitle: $('#activeSubtitle'),
  modePill: $('#modePill'),
  conversation: $('#conversation'), chatFeed: $('#chatFeed'), prompt: $('#promptInput'), form: $('#composerForm'), send: $('#sendBtn'),
  clearInput: $('#clearInputBtn'), voice: $('#voiceBtn'), voiceStatus: $('#voiceStatus'), speak: $('#speakBtn'),
  intentLabel: $('#intentLabel'), intentMeter: $('#intentMeter'), intentConfidence: $('#intentConfidence'), traits: $('#traits'), memoryCount: $('#memoryCount'),
  newChat: $('#newChatBtn'), export: $('#exportBtn'), reset: $('#resetBtn'), createAgent: $('#createAgentBtn'), modal: $('#agentModal'), agentForm: $('#agentForm'), cancelAgent: $('#cancelAgentBtn'), toast: $('#toast')
};

let state = loadState();
let recorder = null;
let chunks = [];
let recordingStream = null;
let toastTimer = null;

function defaultState() {
  return {
    agents: DEFAULT_PERSONALITIES.map((agent) => ({ ...agent })),
    activeAgentId: DEFAULT_PERSONALITIES[0].id,
    conversations: {},
    updatedAt: new Date().toISOString()
  };
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.agents?.length && saved.activeAgentId && saved.conversations) return saved;
  } catch { /* corrupted local state is safely replaced */ }
  return defaultState();
}
function persist() { state.updatedAt = new Date().toISOString(); localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function activeAgent() { return state.agents.find((agent) => agent.id === state.activeAgentId) ?? state.agents[0]; }
function activeMessages() { return state.conversations[state.activeAgentId] ?? []; }
function saveMessages(messages) { state.conversations[state.activeAgentId] = messages; persist(); }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function renderContent(raw) {
  const text = escapeHtml(raw);
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return blocks.map((block) => {
    if (block.startsWith('```')) {
      const match = block.match(/^```[^\n]*\n?([\s\S]*?)```$/);
      return `<pre><code>${match ? match[1] : block}</code></pre>`;
    }
    return block.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/^&gt; (.*)$/gm, '<em>$1</em>').replace(/\n/g, '<br>');
  }).join('');
}
function initials(name) { return sanitizeText(name, 2).toUpperCase() || 'A'; }
function timeLabel(iso) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
function toast(message) { elements.toast.textContent = message; elements.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3500); }

function renderAgents() {
  elements.agentList.replaceChildren(...state.agents.map((agent) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `agent-card ${agent.id === state.activeAgentId ? 'active' : ''}`; button.dataset.agentId = agent.id;
    button.innerHTML = `<span class="avatar" style="background:${escapeHtml(agent.color || '#a78bfa')}">${escapeHtml(initials(agent.name))}</span><span><span class="agent-name">${escapeHtml(agent.name)}</span><span class="agent-role">${escapeHtml(agent.role)}</span></span>`;
    button.addEventListener('click', () => { state.activeAgentId = agent.id; persist(); render(); }); return button;
  }));
}
function renderHeader() {
  const agent = activeAgent();
  elements.activeAvatar.textContent = initials(agent.name); elements.activeAvatar.style.background = agent.color || '#a78bfa';
  elements.activeName.textContent = agent.name; elements.activeSubtitle.textContent = `${agent.role} · ${agent.traits.join(', ')}`;
  elements.traits.replaceChildren(...agent.traits.map((trait) => { const tag = document.createElement('span'); tag.className = 'trait'; tag.textContent = trait; return tag; }));
}
function renderMessages() {
  const messages = activeMessages();
  elements.conversation.replaceChildren();
  if (!messages.length) {
    const greeting = { role: 'assistant', content: `${activeAgent().greeting}\n\nChoose a coding task, describe a bug, or create a personality. **ARPHIX remains offline by default.**`, createdAt: new Date().toISOString(), mode: 'rule-engine' };
    appendMessage(greeting, false);
  } else messages.forEach((message) => appendMessage(message, false));
  elements.memoryCount.textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
  requestAnimationFrame(() => { elements.chatFeed.scrollTop = elements.chatFeed.scrollHeight; });
}
function appendMessage(message, scroll = true) {
  const agent = activeAgent(); const isUser = message.role === 'user';
  const node = document.createElement('article'); node.className = `message ${isUser ? 'user' : 'assistant'}`;
  const color = isUser ? '#334155' : (agent.color || '#a78bfa'); const label = isUser ? 'You' : agent.name;
  node.innerHTML = `<div class="avatar" style="background:${escapeHtml(color)}">${isUser ? 'Y' : escapeHtml(initials(agent.name))}</div><div class="message-body"><p class="message-meta"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(timeLabel(message.createdAt))}${message.mode ? ` · ${escapeHtml(message.mode)}` : ''}</span></p><div class="message-content">${renderContent(message.content)}</div></div>`;
  elements.conversation.append(node); if (scroll) elements.chatFeed.scrollTop = elements.chatFeed.scrollHeight;
}
function updateIntent(input) {
  const detection = detectIntent(input); const percent = Math.round(detection.confidence * 100);
  elements.intentLabel.textContent = detection.label; elements.intentMeter.style.width = `${percent}%`; elements.intentConfidence.textContent = `${percent}% confidence${detection.signals.length ? ` · ${detection.signals.join(', ')}` : ''}`;
}
function render() { renderAgents(); renderHeader(); renderMessages(); updateIntent(elements.prompt.value); }

async function requestLocalModel(text, agent) {
  const system = `You are ${agent.name}, a ${agent.role}. Personality traits: ${agent.traits.join(', ')}. Be helpful, accurate, and concise. This application is offline-first. Do not claim to browse or call external APIs.`;
  try {
    const payload = await generateLocalModelReply({ system, prompt: text, onStatus: (status) => { elements.modePill.textContent = `● ${status}`; } });
    elements.modePill.textContent = `● browser-local · ${payload.backend}`;
    return { content: sanitizeText(payload.content), mode: payload.mode };
  } catch (error) {
    elements.modePill.textContent = '● offline fallback';
    toast(`Browser-local model unavailable; using the final deterministic fallback. ${error.message}`);
    return null;
  }
}
async function submitMessage() {
  const text = sanitizeText(elements.prompt.value); if (!text) return;
  const messages = activeMessages(); const userMessage = { role: 'user', content: text, createdAt: new Date().toISOString() };
  messages.push(userMessage); saveMessages(messages); appendMessage(userMessage); elements.prompt.value = ''; updateIntent(''); elements.send.disabled = true;
  const localModel = await requestLocalModel(text, activeAgent());
  const reply = localModel ?? generateOfflineReply({ text, personality: activeAgent() });
  const assistantMessage = { role: 'assistant', content: reply.content, createdAt: new Date().toISOString(), mode: reply.mode };
  messages.push(assistantMessage); saveMessages(messages); appendMessage(assistantMessage); elements.memoryCount.textContent = `${messages.length} messages`; elements.send.disabled = false;
}
function newConversation() { state.conversations[state.activeAgentId] = []; persist(); renderMessages(); toast(`New ${activeAgent().name} conversation ready.`); }
function downloadConversation() { const payload = exportConversation({ agent: activeAgent(), messages: activeMessages() }); const blob = new Blob([payload], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `arphix-${activeAgent().name.toLowerCase().replace(/\W+/g, '-')}-conversation.md`; link.click(); URL.revokeObjectURL(url); toast('Conversation export created locally.'); }
function closeModal() { elements.modal.hidden = true; elements.agentForm.reset(); }
function createAgent(event) { event.preventDefault(); const name = sanitizeText($('#agentName').value, 24); const role = sanitizeText($('#agentRole').value, 42); const traits = sanitizeText($('#agentTraits').value, 90).split(',').map((trait) => trait.trim()).filter(Boolean).slice(0, 5); if (!name || !role || !traits.length) return toast('Add a name, role, and at least one trait.'); const palette = ['#f59e0b', '#f472b6', '#2dd4bf', '#60a5fa']; const agent = { id: `agent-${crypto.randomUUID()}`, name, role, traits, voice: 'en-US', temperature: 'balanced', greeting: `I’m ${name}, ready to help you work through the next coding decision.`, color: palette[state.agents.length % palette.length] }; state.agents.push(agent); state.activeAgentId = agent.id; persist(); closeModal(); render(); toast(`${name} is ready locally.`); }
function isLocalVoice(voice) { return voice && voice.localService === true; }
function speakLatest() { const latest = [...activeMessages()].reverse().find((message) => message.role === 'assistant'); if (!latest) return toast('There is no assistant response to read yet.'); if (!('speechSynthesis' in window)) return toast('This browser does not expose local speech synthesis.'); const agent = activeAgent(); const voice = speechSynthesis.getVoices().find((item) => isLocalVoice(item) && item.lang.startsWith(agent.voice.slice(0, 2))); if (!voice) return toast('No local system voice is available. ARPHIX will not use a network voice service.'); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(latest.content.replace(/[`*_>#]/g, '')); utterance.voice = voice; utterance.rate = .98; speechSynthesis.speak(utterance); toast('Speaking with a local system voice.'); }
function setVoiceUI(recording, text) { elements.voice.classList.toggle('recording', recording); elements.voice.textContent = recording ? '■' : '●'; elements.voice.setAttribute('aria-label', recording ? 'Stop local voice recording' : 'Start local voice recording'); elements.voiceStatus.textContent = text; }
async function toggleVoice() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Local recording is not supported in this browser.');
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks = []; recorder = new MediaRecorder(recordingStream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
    recorder.addEventListener('dataavailable', (event) => event.data.size && chunks.push(event.data));
    recorder.addEventListener('stop', uploadRecording, { once: true }); recorder.start(); setVoiceUI(true, 'Recording locally…');
  } catch (error) { setVoiceUI(false, 'Voice blocked'); toast(`Microphone unavailable: ${error.message}`); }
}
async function uploadRecording() {
  setVoiceUI(false, 'Transcribing locally…'); recordingStream?.getTracks().forEach((track) => track.stop());
  try { const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); const response = await fetch('./api/transcribe', { method: 'POST', headers: { 'Content-Type': audio.type }, body: audio }); const payload = await response.json(); if (!response.ok) throw new Error(payload.setup || payload.error || 'Unable to transcribe locally'); elements.prompt.value = sanitizeText(payload.transcript); updateIntent(elements.prompt.value); setVoiceUI(false, 'Voice ready'); toast('Local transcript added to the draft.'); }
  catch (error) { setVoiceUI(false, 'Voice setup required'); toast(error.message); }
}

elements.form.addEventListener('submit', (event) => { event.preventDefault(); submitMessage(); });
elements.prompt.addEventListener('input', () => { updateIntent(elements.prompt.value); elements.prompt.style.height = 'auto'; elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 180)}px`; });
elements.prompt.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitMessage(); } });
elements.clearInput.addEventListener('click', () => { elements.prompt.value = ''; updateIntent(''); elements.prompt.focus(); });
elements.voice.addEventListener('click', toggleVoice); elements.speak.addEventListener('click', speakLatest); elements.newChat.addEventListener('click', newConversation); elements.export.addEventListener('click', downloadConversation);
elements.reset.addEventListener('click', () => { if (confirm('Reset all ARPHIX data stored in this browser?')) { localStorage.removeItem(STORE_KEY); state = defaultState(); render(); toast('Local data reset.'); } });
elements.createAgent.addEventListener('click', () => { elements.modal.hidden = false; $('#agentName').focus(); }); elements.cancelAgent.addEventListener('click', closeModal); elements.agentForm.addEventListener('submit', createAgent); elements.modal.addEventListener('click', (event) => { if (event.target === elements.modal) closeModal(); });
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
render();
