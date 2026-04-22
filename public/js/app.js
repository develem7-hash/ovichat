/* ============================
   ECHOLINK — Frontend App
   ============================ */

// ========================
// STATE
// ========================
const state = {
  token: localStorage.getItem('echolink_token'),
  user: null,
  contacts: [],
  groups: [],
  activeChat: null,
  activeChatType: null, // 'dm' | 'group'
  messages: {},
  unreadCounts: {},
  typingTimers: {},
  socket: null,
  // WebRTC
  peerConnection: null,
  localStream: null,
  screenStream: null,
  callPeer: null,
  callType: null, // 'audio' | 'video'
  callTimer: null,
  callSeconds: 0,
  isScreenSharing: false,
  // Recording
  mediaRecorder: null,
  recordingChunks: [],
  recordingTimer: null,
  recordingSeconds: 0,
  replyToMsg: null,
  // Remote Support
  isRemoteSupporter: false,
  isRemoteControlled: false,
  pendingRemoteSupportRequester: null,
  remoteSupportPeerId: null,
  // Desktop Support Foundation
  myDevices: [],
  supportAvailability: {},
  desktopSupportSessions: {},
  incomingDesktopSupportSession: null,
};

const EMOJIS = ['😀','😂','🥰','😍','🤩','😎','🥳','😅','😭','😤','🤔','🤯','😴','🥺','😈','👍','👎','❤️','🔥','💯','🎉','✨','💪','🙌','👏','🤝','💀','👀','🤣','😊','🎊','🚀','💡','⚡','🌟','💎','🏆','🎯','🌈','🍕'];

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const APP_CONFIG = window.ECHOLINK_CONFIG || {};
const API_BASE_URL = (localStorage.getItem('echolink_api_base') || APP_CONFIG.apiBaseUrl || '').replace(/\/+$/, '');
const SOCKET_BASE_URL = (localStorage.getItem('echolink_socket_base') || APP_CONFIG.socketBaseUrl || API_BASE_URL || '').replace(/\/+$/, '');

function buildUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

// ========================
// UTILS
// ========================
function api(path, method = 'GET', body = null) {
  return fetch(buildUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async r => {
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      if (!r.ok) throw new Error(`Server returned error ${r.status}: ${text.substring(0, 100)}`);
      return text;
    }
    if (!r.ok) throw new Error(data.error || `API Error ${r.status}`);
    return data;
  }).catch(err => {
    console.error('API Error:', err);
    return { error: err.message };
  });
}

function formatTime(ts) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  const now = new Date();
  const diffD = Math.floor((now - d) / 86400000);
  if (diffD === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffD = Math.floor((now - d) / 86400000);
  if (diffD === 0) return 'Today';
  if (diffD === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatFileSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDuration(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Notifications Support
function initNotifications() {
  if (!("Notification" in window)) return;
  // Notification.permission check handled in startApp
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  const permission = await Notification.requestPermission();
  return permission;
}

function showLocalNotification(title, options = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  
  // Don't show if window is focused AND it's not a call
  if (document.hasFocus() && !options.requireInteraction) return;

  const notification = new Notification(title, {
    icon: '/assets/logo.png',
    badge: '/assets/logo.png',
    silent: false,
    ...options
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function getAvatar(user) {
  if (!user) return '?';
  return user.avatar_value || (user.display_name || user.username || '?').charAt(0).toUpperCase();
}

function getStatusText(status, lastSeen) {
  if (status === 'online') return 'Online';
  if (status === 'away') return 'Away';
  if (status === 'busy') return 'Busy';
  if (lastSeen) {
    const d = new Date(lastSeen * 1000);
    return `Last seen ${formatTime(lastSeen)}`;
  }
  return 'Offline';
}

function getContactDisplayName(userId) {
  if (!userId) return 'the other participant';
  if (userId === state.user?.id) return state.user?.display_name || state.user?.username || 'You';
  const contact = state.contacts.find(c => c.contact_id === userId);
  return contact?.nickname || contact?.display_name || contact?.username || 'the other participant';
}

function getActiveDirectContact() {
  if (state.activeChatType !== 'dm') return null;
  return state.contacts.find(c => c.contact_id === state.activeChat) || null;
}

function getDesktopSupportStatusText(entity, session = null) {
  if (!entity || entity.isGroup) return '';
  if (session) {
    const peer = session.peer_display_name || entity.nickname || entity.display_name || 'this contact';
    switch (session.status) {
      case 'waiting_for_local_approval':
        return session.is_requester
          ? `Waiting for local approval on ${peer}'s device`
          : `${peer} requested desktop support approval`;
      case 'approved':
        return `Desktop support approved for ${peer}`;
      case 'revoked':
        return `Desktop support was revoked`;
      case 'denied':
        return `Desktop support request was denied`;
      default:
        return `Desktop support status: ${session.status}`;
    }
  }

  const onlineCount = Number(entity.desktop_device_online_count || 0);
  if (onlineCount > 0) return `Desktop companion online on ${onlineCount} device${onlineCount === 1 ? '' : 's'}`;
  return 'Desktop companion required';
}

function updateDesktopSupportHeader(entity = getActiveDirectContact()) {
  const el = document.getElementById('chat-header-support-status');
  const actionBtn = document.getElementById('btn-desktop-support');
  if (!el || !actionBtn) return;

  const isDm = entity && state.activeChatType === 'dm';
  const session = isDm ? state.desktopSupportSessions[entity.contact_id] : null;
  el.classList.toggle('hidden', !isDm);
  actionBtn.classList.toggle('hidden', !isDm);

  if (!isDm) return;

  el.textContent = getDesktopSupportStatusText(entity, session);
  actionBtn.classList.toggle('active', Boolean(session && ['waiting_for_local_approval', 'approved', 'connecting', 'active', 'paused'].includes(session.status)));
}

function applyDesktopSupportSession(session) {
  if (!session) return;
  state.desktopSupportSessions[session.peer_user_id] = session;
  if (state.activeChat === session.peer_user_id && state.activeChatType === 'dm') {
    updateDesktopSupportHeader();
    renderDesktopSupportModal();
  }
}

function updateRemoteSupportUI() {
  const banner = document.getElementById('remote-support-banner');
  const title = document.getElementById('remote-support-status-title');
  const copy = document.getElementById('remote-support-status-copy');
  const stopBtn = document.getElementById('btn-stop-remote-support');
  const requestBtn = document.getElementById('btn-remote-support');
  if (!banner || !title || !copy || !stopBtn || !requestBtn) return;

  const isActive = state.isRemoteSupporter || state.isRemoteControlled;
  banner.classList.toggle('hidden', !isActive);
  requestBtn.classList.toggle('active', state.isRemoteSupporter);
  requestBtn.title = state.isRemoteSupporter ? 'End Remote Support' : 'Request Remote Support';

  if (!isActive) {
    title.textContent = 'Remote support inactive';
    copy.textContent = 'Remote support is not active.';
    stopBtn.classList.add('hidden');
    return;
  }

  const peerName = getContactDisplayName(state.remoteSupportPeerId || state.callPeer);
  if (state.isRemoteControlled) {
    title.textContent = 'Remote support active';
    copy.textContent = `${peerName} can move the cursor, click, and type in this EchoLink session. You can stop access at any time.`;
    stopBtn.classList.remove('hidden');
  } else {
    title.textContent = 'You are providing remote support';
    copy.textContent = `${peerName} granted you access for this EchoLink session and can stop access whenever they want.`;
    stopBtn.classList.add('hidden');
  }
}

function resetRemoteSupportState() {
  state.isRemoteSupporter = false;
  state.isRemoteControlled = false;
  state.pendingRemoteSupportRequester = null;
  state.remoteSupportPeerId = null;
  document.getElementById('remote-cursor')?.remove();
  const consent = document.getElementById('remote-support-consent');
  const allowBtn = document.getElementById('btn-allow-remote');
  if (consent) consent.checked = false;
  if (allowBtn) allowBtn.disabled = true;
  updateRemoteSupportUI();
}

function endRemoteSupport(notifyPeer = true) {
  const peerId = state.remoteSupportPeerId || state.callPeer;
  if (notifyPeer && peerId) {
    state.socket?.emit('remote-support-ended', { to: peerId });
  }
  resetRemoteSupportState();
}

function getFileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊', zip: '🗜️', rar: '🗜️', mp3: '🎵', wav: '🎵', mp4: '🎬', mov: '🎬', avi: '🎬' };
  return icons[ext] || '📎';
}

// ========================
// AUTH
// ========================
function initAuth() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    });
  });

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    if (!username || !password) { errEl.textContent = 'All fields required'; return; }
    const res = await api('/api/auth/login', 'POST', { username, password });
    if (res.error) { errEl.textContent = res.error; return; }
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('echolink_token', res.token);
    startApp();
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const display_name = document.getElementById('reg-display-name').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('reg-error');
    errEl.textContent = '';
    if (!display_name || !username || !password) { errEl.textContent = 'All fields required'; return; }
    if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
    const res = await api('/api/auth/register', 'POST', { display_name, username, password });
    if (res.error) { errEl.textContent = res.error; return; }
    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('echolink_token', res.token);
    startApp();
  });
}

// ========================
// APP START
// ========================
async function startApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateMyProfile();
  await loadContacts();
  await loadGroups();
  await loadUnreadCounts();
  await loadMyDevices();
  initSocket();
  initEmojis();
  initKeyboardShortcuts();
  initTheme();
  initNotifications();
  startNetworkMonitor();
  loadPendingRequests();

  // Prompt for notifications if not yet decided
  if ("Notification" in window && Notification.permission === "default") {
    setTimeout(() => {
      toast("Enable desktop notifications for calls and messages?", "info");
      document.body.addEventListener('click', () => requestNotificationPermission(), { once: true });
    }, 3000);
  }
}

function updateMyProfile() {
  const u = state.user;
  if (!u) return;
  document.getElementById('my-avatar').textContent = getAvatar(u);
  document.getElementById('my-display-name').textContent = u.display_name;
  document.getElementById('my-status-text').textContent = u.status || 'Online';
  const dot = document.getElementById('my-status-dot');
  dot.className = `status-dot ${u.status || 'online'}`;
}

// ========================
// SOCKET
// ========================
function initSocket() {
  state.socket = io(SOCKET_BASE_URL || undefined, {
    auth: { token: state.token },
    transports: ['websocket', 'polling']
  });

  state.socket.on('connect', () => console.log('Socket connected'));

  state.socket.on('presence', ({ userId, status, custom_status }) => {
    const contact = state.contacts.find(c => c.contact_id === userId || c.id === userId);
    if (contact) {
      contact.status = status;
      if (custom_status !== undefined) contact.custom_status = custom_status;
    }
    renderContacts();
    if (state.activeChat === userId) {
      document.getElementById('chat-header-status').textContent = getStatusText(status, null);
    }
  });

  state.socket.on('desktop-device-status', ({ userId }) => {
    if (!userId) return;
    const contact = state.contacts.find(c => c.contact_id === userId);
    if (contact) {
      loadContacts();
      if (state.activeChat === userId) loadSupportAvailability(userId).then(() => renderDesktopSupportModal());
    }
  });

  state.socket.on('message', (msg) => {
    const chatId = msg.from_user_id;
    if (!state.messages[chatId]) state.messages[chatId] = [];
    state.messages[chatId].push(msg);
    if (state.activeChat === chatId && state.activeChatType === 'dm') {
      appendMessage(msg, false);
      scrollToBottom();
      state.socket.emit('seen', { from: chatId });
    } else {
      state.unreadCounts[chatId] = (state.unreadCounts[chatId] || 0) + 1;
      const contact = state.contacts.find(c => c.contact_id === chatId);
      showLocalNotification(`Message from ${contact?.display_name || 'User'}`, {
        body: msg.text || '📄 [Attachment]',
        tag: `chat-${chatId}`
      });
    }
    renderContacts();
    // Deliver receipt
    state.socket.emit('delivered', { to: chatId, msgId: msg.id });
  });

  state.socket.on('message-sent', (msg) => {
    const chatId = msg.to_user_id;
    if (!state.messages[chatId]) state.messages[chatId] = [];
    // Replace temp
    const idx = state.messages[chatId].findIndex(m => m.tempId === msg.tempId);
    if (idx > -1) {
      state.messages[chatId][idx] = msg;
      const el = document.querySelector(`[data-temp-id="${msg.tempId}"]`);
      if (el) el.dataset.msgId = msg.id;
    } else {
      state.messages[chatId].push(msg);
      if (state.activeChat === chatId) appendMessage(msg, true);
    }
  });

  state.socket.on('group-message', (msg) => {
    const gId = msg.group_id;
    if (!state.messages['g_' + gId]) state.messages['g_' + gId] = [];
    state.messages['g_' + gId].push(msg);
    if (state.activeChat === gId && state.activeChatType === 'group') {
      appendMessage(msg, msg.from_user_id === state.user.id);
      scrollToBottom();
    } else {
      state.unreadCounts['g_' + gId] = (state.unreadCounts['g_' + gId] || 0) + 1;
    }
    renderContacts();
  });

  state.socket.on('typing', ({ from, isTyping }) => {
    if (state.activeChat !== from) return;
    const el = document.getElementById('typing-indicator');
    const contact = state.contacts.find(c => c.contact_id === from);
    document.getElementById('typing-name').textContent = contact?.display_name || 'Someone';
    el.classList.toggle('hidden', !isTyping);
  });

  state.socket.on('seen', ({ by }) => {
    // Update message status icons
    if (state.activeChat === by) {
      document.querySelectorAll('.message-status').forEach(el => {
        el.className = 'message-status read-s';
        el.textContent = '✓✓';
      });
    }
  });

  state.socket.on('reaction', ({ messageId, reactions, groupId }) => {
    const el = document.querySelector(`[data-msg-id="${messageId}"] .message-reactions`);
    if (el) el.outerHTML = renderReactionsHTML(reactions, messageId, state.activeChat, groupId);
  });

  state.socket.on('connection-request', (data) => {
    state.pendingRequests = state.pendingRequests || [];
    state.pendingRequests.unshift(data);
    updateRequestsBadge();
    toast(`${data.from_user.display_name} wants to connect!`, 'info');
  });

  state.socket.on('message-deleted', ({ messageId, chatId, groupId }) => {
    const key = groupId ? 'g_' + groupId : chatId;
    if (state.messages[key]) {
      state.messages[key] = state.messages[key].filter(m => m.id !== messageId);
    }
    if ((groupId && state.activeChat === groupId) || (!groupId && state.activeChat === chatId)) {
      document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
    }
  });

  state.socket.on('request-response', ({ type, user }) => {
    if (type === 'accepted') {
      toast(`${user.display_name} accepted your request!`, 'success');
      loadContacts();
    }
  });

  state.socket.on('call-offer', (data) => {
    if (state.peerConnection && state.peerConnection.signalingState !== 'stable') {
      // Handle re-negotiation (re-offer)
      handleIncomingReOffer(data);
    } else {
      handleIncomingCall(data);
    }
  });
  state.socket.on('call-answer', handleCallAnswer);
  state.socket.on('ice-candidate', handleIceCandidate);
  state.socket.on('call-end', () => endCall(false));
  state.socket.on('call-reject', () => { toast('Call rejected', 'info'); endCall(false); });

  // Remote Support Sockets
  state.socket.on('remote-support-request', ({ from }) => {
    state.pendingRemoteSupportRequester = from;
    state.remoteSupportPeerId = from;
    document.getElementById('remote-request-name').textContent = getContactDisplayName(from);
    document.getElementById('remote-support-consent').checked = false;
    document.getElementById('btn-allow-remote').disabled = true;
    openModal('remote-access-modal');
    toast(`${getContactDisplayName(from)} requested remote support. Review the access details before allowing it.`, 'info');
  });

  state.socket.on('remote-support-granted', ({ from }) => {
    state.isRemoteSupporter = true;
    state.isRemoteControlled = false;
    state.remoteSupportPeerId = from || state.callPeer;
    updateRemoteSupportUI();
    toast(`${getContactDisplayName(from || state.callPeer)} granted remote support for this EchoLink session.`, 'success');
  });

  state.socket.on('remote-support-denied', ({ from }) => {
    state.pendingRemoteSupportRequester = null;
    toast(`${getContactDisplayName(from || state.callPeer)} denied the remote support request.`, 'error');
  });

  state.socket.on('remote-support-ended', ({ from }) => {
    const endedBy = getContactDisplayName(from || state.remoteSupportPeerId || state.callPeer);
    const message = state.isRemoteControlled
      ? `${endedBy} ended remote support.`
      : `Remote support with ${endedBy} has ended.`;
    resetRemoteSupportState();
    toast(message, 'info');
  });

  state.socket.on('desktop-support-requested', (session) => {
    applyDesktopSupportSession(session);
    state.incomingDesktopSupportSession = session;
    document.getElementById('desktop-support-request-name').textContent = session.peer_display_name || getContactDisplayName(session.peer_user_id);
    openModal('desktop-support-request-modal');
    toast(`${session.peer_display_name || getContactDisplayName(session.peer_user_id)} requested desktop support.`, 'info');
  });

  state.socket.on('desktop-support-updated', (session) => {
    applyDesktopSupportSession(session);
  });

  state.socket.on('desktop-support-approved', (session) => {
    applyDesktopSupportSession(session);
    toast(`Desktop support approved by ${session.peer_display_name || getContactDisplayName(session.peer_user_id)}.`, 'success');
  });

  state.socket.on('desktop-support-denied', (session) => {
    applyDesktopSupportSession(session);
    toast(`Desktop support was denied by ${session.peer_display_name || getContactDisplayName(session.peer_user_id)}.`, 'error');
  });

  state.socket.on('desktop-support-revoked', (session) => {
    applyDesktopSupportSession(session);
    toast(`Desktop support was revoked by ${session.peer_display_name || getContactDisplayName(session.peer_user_id)}.`, 'info');
  });
}

// ========================
// CONTACTS
// ========================
async function loadContacts() {
  const contacts = await api('/api/contacts/list');
  state.contacts = contacts || [];
  renderContacts();
  updateRemoteSupportUI();
  updateDesktopSupportHeader();
}

async function loadGroups() {
  const groups = await api('/api/groups');
  state.groups = groups || [];
  renderContacts();
}

async function loadMyDevices() {
  const devices = await api('/api/devices');
  state.myDevices = Array.isArray(devices) ? devices : [];
}

async function loadSupportAvailability(userId) {
  if (!userId) return null;
  const result = await api(`/api/users/${userId}/support-availability`);
  if (result?.error) return null;
  state.supportAvailability[userId] = result;
  return result;
}

async function loadDesktopSupportSessions(contactId) {
  if (!contactId) return [];
  const sessions = await api(`/api/support-sessions?contact_id=${encodeURIComponent(contactId)}&limit=5`);
  if (Array.isArray(sessions) && sessions.length) {
    applyDesktopSupportSession(sessions[0]);
  } else {
    delete state.desktopSupportSessions[contactId];
  }
  return Array.isArray(sessions) ? sessions : [];
}

async function loadUnreadCounts() {
  const counts = await api('/api/messages/unread/counts');
  if (Array.isArray(counts)) {
    counts.forEach(c => { state.unreadCounts[c.from_user_id] = c.count; });
  }
}

async function loadPendingRequests() {
  const requests = await api('/api/contacts/requests/pending');
  state.pendingRequests = requests || [];
  updateRequestsBadge();
}

function updateRequestsBadge() {
  const count = state.pendingRequests?.length || 0;
  const badge = document.getElementById('requests-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

function renderContacts() {
  const list = document.getElementById('contacts-list');
  const search = document.getElementById('contact-search').value.toLowerCase();

  let items = [...state.contacts, ...state.groups.map(g => ({ ...g, isGroup: true, contact_id: g.id }))];
  if (search) items = items.filter(c => (c.display_name || c.name || '').toLowerCase().includes(search) || (c.username || '').toLowerCase().includes(search));

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>${search ? 'No results' : 'No contacts yet'}</p>${!search ? `<button class="btn-secondary" onclick="document.getElementById('btn-find-users').click()">Find People</button>` : ''}</div>`;
    return;
  }

  // Sort: favorites first, then by last message or name
  const sorted = items.sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    return 0;
  });

  list.innerHTML = sorted.map(c => {
    const id = c.isGroup ? c.id : c.contact_id;
    const chatKey = c.isGroup ? 'g_' + id : id;
    const name = c.isGroup ? c.name : (c.nickname || c.display_name);
    const avatar = c.isGroup ? (c.avatar || name.charAt(0)) : getAvatar(c);
    const status = c.isGroup ? null : c.status;
    const unread = state.unreadCounts[c.isGroup ? 'g_' + id : id] || 0;
    const msgs = state.messages[chatKey] || [];
    const lastMsg = msgs[msgs.length - 1];
    const isActive = state.activeChat === id;

    return `
      <div class="contact-item ${isActive ? 'active' : ''}" onclick="openChat('${id}', '${c.isGroup ? 'group' : 'dm'}')">
        <div class="avatar-wrap">
          <div class="avatar sm">${avatar}</div>
          ${status ? `<div class="status-dot avatar-status ${status}"></div>` : ''}
        </div>
        <div class="contact-info">
          <div class="contact-name">${name}${c.is_favorite ? ' ⭐' : ''}</div>
          <div class="contact-last-msg">${lastMsg ? (lastMsg.message_type !== 'text' ? `📎 ${lastMsg.message_type}` : (lastMsg.message || '')) : (c.custom_status || '')}</div>
        </div>
        <div class="contact-meta">
          ${lastMsg ? `<span class="contact-time">${formatTime(lastMsg.created_at)}</span>` : ''}
          ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ========================
// OPEN CHAT
// ========================
async function openChat(id, type = 'dm') {
  state.activeChat = id;
  state.activeChatType = type;
  state.unreadCounts[type === 'group' ? 'g_' + id : id] = 0;

  const chatEmpty = document.getElementById('chat-empty');
  const chatView = document.getElementById('chat-view');
  chatEmpty.classList.add('hidden');
  chatView.classList.remove('hidden');

  // Find entity
  let entity;
  if (type === 'group') {
    entity = state.groups.find(g => g.id === id);
  } else {
    entity = state.contacts.find(c => c.contact_id === id);
  }

  if (!entity) return;

  const name = type === 'group' ? entity.name : (entity.nickname || entity.display_name);
  const avatar = type === 'group' ? (entity.avatar || name.charAt(0)) : getAvatar(entity);

  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('chat-header-avatar').textContent = avatar;
  document.getElementById('chat-header-status').textContent = type === 'group' ? 'Group' : getStatusText(entity.status, entity.last_seen);
  updateDesktopSupportHeader(type === 'dm' ? entity : null);

  // Show/hide call buttons for groups
  document.getElementById('btn-audio-call').classList.toggle('hidden', type === 'group');
  document.getElementById('btn-video-call').classList.toggle('hidden', type === 'group');
  document.getElementById('btn-screen-share').classList.toggle('hidden', type === 'group');

  // Load messages
  const area = document.getElementById('messages-area');
  area.innerHTML = '<div class="messages-loading"><div class="spinner"></div></div>';

  const chatKey = type === 'group' ? 'g_' + id : id;
  let msgs;
  if (type === 'group') {
    msgs = await api(`/api/groups/${id}/messages`);
  } else {
    msgs = await api(`/api/messages/${id}`);
    state.socket?.emit('seen', { from: id });
  }
  state.messages[chatKey] = msgs || [];

  renderMessages(msgs || []);
  renderContacts();
  scrollToBottom(false);
  if (type === 'dm') {
    loadSupportAvailability(id).then(() => renderDesktopSupportModal());
    loadDesktopSupportSessions(id).then(() => updateDesktopSupportHeader(entity));
  }

  // Mobile: hide sidebar
  if (window.innerWidth <= 768) {
    document.getElementById('panel-left').classList.add('hidden-mobile');
  }
}

function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  area.innerHTML = '';

  let lastDate = null;
  msgs.forEach(msg => {
    const date = formatDate(msg.created_at);
    if (date !== lastDate) {
      area.innerHTML += `<div class="day-divider"><span>${date}</span></div>`;
      lastDate = date;
    }
    area.innerHTML += buildMessageHTML(msg);
  });
}

function appendMessage(msg, isSent) {
  const area = document.getElementById('messages-area');
  const loading = area.querySelector('.messages-loading');
  if (loading) loading.remove();
  area.insertAdjacentHTML('beforeend', buildMessageHTML(msg));
}

window.deleteMsg = async function(msgId, btn) {
  const wrapper = btn?.closest('.message-wrapper');
  const realId = wrapper?.dataset.msgId || msgId;
  
  if (!realId || realId === 'undefined' || realId === 'null') {
    toast('Error: Message ID not found. Please refresh.', 'error');
    console.error('Delete failed: Missing realId', { msgId, dataset: wrapper?.dataset });
    return;
  }

  if (realId.startsWith('tmp-')) {
    toast('Message still sending, please wait...', 'info');
    return;
  }

  const isGroup = state.activeChatType === 'group';
  const chatId = state.activeChat;
  if (!chatId) {
    toast('Error: Chat context lost.', 'error');
    return;
  }

  const url = isGroup ? `/api/groups/${chatId}/messages/${realId}` : `/api/messages/${realId}`;
  console.log('[DEBUG] Delete Request:', { method: 'DELETE', url, isGroup, chatId, realId });
  
  const res = await api(url, 'DELETE');
  if (res.error) {
    toast(res.error, 'error');
    return;
  }
  
  const chatKey = isGroup ? 'g_' + chatId : chatId;
  if (state.messages[chatKey]) {
    state.messages[chatKey] = state.messages[chatKey].filter(m => m.id !== realId);
  }
  (wrapper || document.querySelector(`[data-msg-id="${realId}"]`))?.remove();
  toast('Message deleted', 'info');
};

function buildMessageHTML(msg) {
  const isSent = msg.from_user_id === state.user?.id;
  const side = isSent ? 'sent' : 'recv';
  const time = formatTime(msg.created_at);
  const reactions = JSON.parse(msg.reactions || '{}');
  const tempId = msg.tempId || '';

  let content = '';

  if (msg.message_type === 'image') {
    content = `<div class="img-msg" onclick="viewImage('${msg.file_url}')"><img src="${msg.file_url}" loading="lazy" alt="${msg.file_name || 'image'}"></div>`;
    if (msg.message) content += `<div style="margin-top:4px">${escapeHtml(msg.message)}</div>`;
  } else if (msg.message_type === 'file') {
    content = `<div class="file-msg">
      <div class="file-icon">${getFileIcon(msg.file_name)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(msg.file_name || 'File')}</div>
        <div class="file-size">${formatFileSize(msg.file_size || 0)}</div>
      </div>
      <a href="${msg.file_url}" download="${msg.file_name}" class="file-download">⬇</a>
    </div>`;
  } else if (msg.message_type === 'voice') {
    const bars = Array.from({length: 20}, (_, i) => {
      const h = 4 + Math.abs(Math.sin(i * 0.8)) * 20;
      return `<span style="height:${h}px"></span>`;
    }).join('');
    content = `<div class="voice-msg">
      <button class="voice-play-btn" onclick="playVoice('${msg.file_url}', this)">▶</button>
      <div class="voice-waveform">${bars}</div>
      <span class="voice-duration" id="vd-${msg.id}">${msg.voice_duration || '0:00'}</span>
      <button class="voice-speed-btn" onclick="toggleVoiceSpeed(this)">1×</button>
    </div>`;
  } else {
    content = escapeHtml(msg.message || '');
  }

  const replyHTML = msg.reply_to_id ? `<div class="reply-in-bubble"><small>↩ Reply</small><div>${escapeHtml(msg.reply_preview || '')}</div></div>` : '';
  const reactionsHTML = renderReactionsHTML(reactions, msg.id, state.activeChat, state.activeChatType === 'group' ? state.activeChat : null);
  const statusHTML = isSent ? `<span class="message-status ${msg.is_read ? 'read-s' : msg.is_delivered ? 'delivered-s' : 'sent-s'}">${msg.is_read ? '✓✓' : msg.is_delivered ? '✓✓' : '✓'}</span>` : '';
  const senderHTML = !isSent && state.activeChatType === 'group' ? `<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:2px">${escapeHtml(msg.display_name || '')}</div>` : '';

  return `
    <div class="message-wrapper ${side}" data-msg-id="${msg.id}" data-temp-id="${tempId}">
      ${senderHTML}
      <div class="message-bubble" onmouseenter="showMsgActions(this)">
        <div class="message-actions" id="actions-${msg.id}">
          <button class="msg-action-btn" onclick="addReaction('${msg.id}')" title="React">😊</button>
          <button class="msg-action-btn" onclick="replyTo('${msg.id}', '${escapeAttr(msg.message || '')}')" title="Reply">↩</button>
          ${isSent ? `<button class="msg-action-btn" onclick="deleteMsg('${msg.id}', this)" title="Delete">🗑</button>` : ''}
        </div>
        ${replyHTML}
        ${content}
      </div>
      ${reactionsHTML}
      <div class="message-meta">
        <span>${time}</span>
        ${statusHTML}
      </div>
    </div>
  `;
}

function renderReactionsHTML(reactions, msgId, chatId, groupId) {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  if (!entries.length) return `<div class="message-reactions" data-msg-id="${msgId}"></div>`;
  return `<div class="message-reactions" data-msg-id="${msgId}">
    ${entries.map(([emoji, users]) => `
      <span class="reaction-chip" onclick="sendReaction('${msgId}', '${emoji}', '${chatId || ''}', '${groupId || ''}')">
        ${emoji} <span class="count">${users.length}</span>
      </span>
    `).join('')}
  </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function scrollToBottom(smooth = true) {
  const area = document.getElementById('messages-area');
  area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// ========================
// SEND MESSAGE
// ========================
function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.innerText.trim();
  if (!text || !state.activeChat) return;
  input.innerHTML = '';

  const tempId = 'tmp-' + Date.now();
  const msg = {
    to: state.activeChat,
    message: text,
    type: 'text',
    tempId,
    reply_to_id: state.replyToMsg?.id || null,
  };

  // Optimistic UI
  const optimistic = {
    id: tempId, tempId,
    from_user_id: state.user.id,
    to_user_id: state.activeChat,
    message: text, message_type: 'text',
    created_at: Math.floor(Date.now() / 1000),
    is_read: 0, is_delivered: 0,
    reactions: '{}',
    reply_to_id: state.replyToMsg?.id,
    reply_preview: state.replyToMsg?.message,
  };

  const chatKey = state.activeChatType === 'group' ? 'g_' + state.activeChat : state.activeChat;
  if (!state.messages[chatKey]) state.messages[chatKey] = [];
  state.messages[chatKey].push(optimistic);
  appendMessage(optimistic, true);
  scrollToBottom();

  if (state.activeChatType === 'group') {
    state.socket.emit('group-message', { groupId: state.activeChat, message: text });
  } else {
    state.socket.emit('message', msg);
  }

  clearReply();
}

// ========================
// TYPING
// ========================
function handleTyping() {
  if (!state.activeChat || state.activeChatType !== 'dm') return;
  state.socket?.emit('typing', { to: state.activeChat, isTyping: true });
  clearTimeout(state.typingTimers[state.activeChat]);
  state.typingTimers[state.activeChat] = setTimeout(() => {
    state.socket?.emit('typing', { to: state.activeChat, isTyping: false });
  }, 2000);
}

// ========================
// FILE UPLOAD
// ========================
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(buildUrl('/api/upload'), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.token}` },
    body: formData
  });
  return res.json();
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file || !state.activeChat) return;

  toast('Uploading...', 'info');
  const result = await uploadFile(file);
  if (!result.url) { toast('Upload failed', 'error'); return; }

  const isImage = file.type.startsWith('image/');
  const type = isImage ? 'image' : 'file';

  const msg = {
    to: state.activeChat,
    message: '',
    type,
    file_url: result.url,
    file_name: result.name,
    file_size: result.size,
  };

  if (state.activeChatType === 'group') {
    state.socket.emit('group-message', { groupId: state.activeChat, ...msg, message: '' });
  } else {
    state.socket.emit('message', msg);
  }

  e.target.value = '';
}

// ========================
// REACTIONS
// ========================
const QUICK_REACTIONS = ['👍','❤️','😂','😮','😢','🔥'];

function addReaction(msgId) {
  const existing = document.getElementById('quick-react-' + msgId);
  if (existing) { existing.remove(); return; }
  const popup = document.createElement('div');
  popup.id = 'quick-react-' + msgId;
  popup.style.cssText = 'position:fixed;background:var(--bg-2);border:1px solid var(--border);border-radius:20px;padding:6px 10px;display:flex;gap:4px;z-index:999;box-shadow:var(--shadow-md)';
  QUICK_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;padding:2px 4px;border-radius:8px;transition:transform 0.1s';
    btn.onmouseenter = () => btn.style.transform = 'scale(1.3)';
    btn.onmouseleave = () => btn.style.transform = 'scale(1)';
    btn.onclick = () => { sendReaction(msgId, emoji, state.activeChat, state.activeChatType === 'group' ? state.activeChat : null); popup.remove(); };
    popup.appendChild(btn);
  });
  // Position near the message
  const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (msgEl) {
    const rect = msgEl.getBoundingClientRect();
    popup.style.top = (rect.top - 50) + 'px';
    popup.style.left = rect.left + 'px';
  }
  document.body.appendChild(popup);
  setTimeout(() => { document.addEventListener('click', () => popup.remove(), { once: true }); }, 10);
}

function sendReaction(msgId, reaction, to, groupId) {
  state.socket?.emit('reaction', { messageId: msgId, reaction, to, groupId: groupId || null });
}

// ========================
// REPLY
// ========================
function replyTo(msgId, text) {
  state.replyToMsg = { id: msgId, message: text };
  document.getElementById('reply-text-preview').textContent = text.substring(0, 80);
  document.getElementById('reply-preview').classList.remove('hidden');
  document.getElementById('message-input').focus();
}

function clearReply() {
  state.replyToMsg = null;
  document.getElementById('reply-preview').classList.add('hidden');
}

// ========================
// VOICE MESSAGE
// ========================
function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    state.recordingChunks = [];
    state.recordingSeconds = 0;

    state.mediaRecorder.ondataavailable = e => state.recordingChunks.push(e.data);
    state.mediaRecorder.onstop = sendVoiceMessage;
    state.mediaRecorder.start(100);

    document.getElementById('voice-recording-ui').classList.remove('hidden');
    state.recordingTimer = setInterval(() => {
      state.recordingSeconds++;
      document.getElementById('rec-timer').textContent = formatDuration(state.recordingSeconds);
      if (state.recordingSeconds >= 120) stopRecording();
    }, 1000);
  }).catch(() => toast('Microphone access denied', 'error'));
}

function stopRecording() {
  if (!state.mediaRecorder) return;
  state.mediaRecorder.stop();
  state.mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(state.recordingTimer);
  document.getElementById('voice-recording-ui').classList.add('hidden');
}

async function sendVoiceMessage() {
  const blob = new Blob(state.recordingChunks, { type: 'audio/webm;codecs=opus' });
  const formData = new FormData();
  formData.append('file', blob, `voice-${Date.now()}.webm`);
  const res = await fetch(buildUrl('/api/upload'), {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${state.token}` },
    body: formData
  });
  const result = await res.json();
  if (result.url) {
    const msg = { to: state.activeChat, type: 'voice', file_url: result.url, file_name: result.name, file_size: result.size, voice_duration: formatDuration(state.recordingSeconds) };
    if (state.activeChatType === 'group') {
      state.socket.emit('group-message', { groupId: state.activeChat, ...msg });
    } else {
      state.socket.emit('message', msg);
    }
  }
}

const voiceAudios = {};
function playVoice(url, btn) {
  if (!voiceAudios[url]) voiceAudios[url] = new Audio(url);
  const audio = voiceAudios[url];
  if (audio.paused) {
    audio.play();
    btn.textContent = '⏸';
    audio.onended = () => btn.textContent = '▶';
  } else {
    audio.pause();
    btn.textContent = '▶';
  }
}

const voiceSpeeds = [1, 1.5, 2];
function toggleVoiceSpeed(btn) {
  const url = btn.closest('.voice-msg')?.querySelector('.voice-play-btn')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
  if (!url || !voiceAudios[url]) return;
  const cur = voiceAudios[url].playbackRate;
  const next = voiceSpeeds[(voiceSpeeds.indexOf(cur) + 1) % voiceSpeeds.length];
  voiceAudios[url].playbackRate = next;
  btn.textContent = `${next}×`;
}

// ========================
// IMAGE VIEWER
// ========================
function viewImage(url) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:2000;cursor:zoom-out';
  overlay.innerHTML = `<img src="${url}" style="max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ========================
// WEBRTC CALLS
// ========================
async function startCall(type) {
  if (!state.activeChat || state.activeChatType !== 'dm') return;
  state.callType = type;
  state.callPeer = state.activeChat;

  const constraints = { audio: true, video: type === 'video' ? { width: 320, height: 240, frameRate: 15 } : false };
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) { 
    console.error('Media access error:', err);
    toast('Camera/mic access denied', 'error'); 
    return; 
  }

  document.getElementById('local-video').srcObject = state.localStream;

  state.peerConnection = new RTCPeerConnection(ICE_SERVERS);
  state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));

  // Data channel for support tools
  state.dataChannel = state.peerConnection.createDataChannel('support', { negotiated: true, id: 0 });
  setupDataChannel();

  state.peerConnection.ontrack = e => {
    const remoteVid = document.getElementById('remote-video');
    if (e.streams && e.streams[0]) {
      remoteVid.srcObject = e.streams[0];
    }
  };

  state.peerConnection.onicecandidate = e => {
    if (e.candidate) {
      state.socket.emit('ice-candidate', { to: state.callPeer, candidate: e.candidate });
    }
  };

  try {
    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    state.socket.emit('call-offer', { to: state.callPeer, offer, callType: type });
  } catch (err) {
    console.error('Initial offer error:', err);
    toast('Failed to initialize call', 'error');
    return;
  }

  showCallPanel(type);
  toast(`Calling...`, 'info');
}

async function handleIncomingCall({ from, offer, callType }) {
  state.pendingCall = { from, offer, callType };
  const contact = state.contacts.find(c => c.contact_id === from);
  const name = contact?.display_name || 'Unknown';
  document.getElementById('incoming-call-name').textContent = name;
  document.getElementById('incoming-call-avatar').textContent = getAvatar(contact);
  openModal('incoming-call-modal');

  showLocalNotification(`Incoming ${callType} Call`, {
    body: `${name} is calling you on EchoLink`,
    tag: 'call-request',
    requireInteraction: true
  });
  document.getElementById('incoming-call-type').textContent = callType === 'video' ? '📹 Video Call' : '📞 Audio Call';
}

async function acceptCall() {
  document.getElementById('incoming-call-modal').classList.add('hidden');
  const { from, offer, callType } = state.pendingCall;
  state.callPeer = from;
  state.callType = callType;

  const constraints = { audio: true, video: callType === 'video' ? { width: 320, height: 240, frameRate: 15 } : false };
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch { toast('Camera/mic access denied', 'error'); return; }

  document.getElementById('local-video').srcObject = state.localStream;

  state.peerConnection = new RTCPeerConnection(ICE_SERVERS);
  state.localStream.getTracks().forEach(t => state.peerConnection.addTrack(t, state.localStream));

  // Initialize Data Channel
  state.dataChannel = state.peerConnection.createDataChannel('support', { negotiated: true, id: 0 });
  setupDataChannel();

  state.peerConnection.onnegotiationneeded = async () => {
    try {
      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);
      state.socket.emit('call-offer', { to: state.callPeer, offer, callType: state.callType });
    } catch (err) { console.error('Negotiation error:', err); }
  };

  state.peerConnection.ontrack = e => {
    const remoteVid = document.getElementById('remote-video');
    if (e.streams && e.streams[0]) {
      remoteVid.srcObject = e.streams[0];
    }
  };
  state.peerConnection.onicecandidate = e => {
    if (e.candidate) state.socket.emit('ice-candidate', { to: state.callPeer, candidate: e.candidate });
  };

  await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);
  state.socket.emit('call-answer', { to: state.callPeer, answer });

  showCallPanel(callType);
}

async function handleCallAnswer({ answer }) {
  if (state.peerConnection) await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIceCandidate({ candidate }) {
  if (state.peerConnection && candidate) await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

function showCallPanel(type) {
  const panel = document.getElementById('panel-right');
  panel.classList.remove('hidden');
  document.getElementById('floating-call-btn').classList.add('hidden');
  if (window.innerWidth <= 768) {
    panel.classList.add('active-call-mobile');
  }
  document.getElementById('call-type-label').textContent = type === 'video' ? '📹 Video Call' : '📞 Audio Call';
  document.getElementById('local-video').classList.toggle('hidden', type !== 'video');
  state.callSeconds = 0;
  state.callTimer = setInterval(() => {
    state.callSeconds++;
    document.getElementById('call-timer').textContent = formatDuration(state.callSeconds);
  }, 1000);
}

function endCall(notify = true) {
  if (notify && state.callPeer) state.socket?.emit('call-end', { to: state.callPeer });
  if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
  if (state.screenStream) state.screenStream.getTracks().forEach(t => t.stop());
  if (state.peerConnection) { state.peerConnection.close(); state.peerConnection = null; }
  clearInterval(state.callTimer);
  state.localStream = null;
  state.screenStream = null;
  state.callPeer = null;
  state.callType = null;
  state.isScreenSharing = false;
  resetRemoteSupportState();
  const panel = document.getElementById('panel-right');
  panel.classList.add('hidden');
  panel.classList.remove('active-call-mobile');
  document.getElementById('floating-call-btn').classList.add('hidden');
  document.getElementById('local-video').srcObject = null;
  document.getElementById('remote-video').srcObject = null;
  document.getElementById('incoming-call-modal').classList.add('hidden');
}

function toggleMute() {
  if (!state.localStream) return;
  const track = state.localStream.getAudioTracks()[0];
  if (track) { track.enabled = !track.enabled; document.getElementById('btn-toggle-mute').classList.toggle('active', !track.enabled); }
}

function toggleCamera() {
  if (!state.localStream) return;
  const track = state.localStream.getVideoTracks()[0];
  if (track) { track.enabled = !track.enabled; document.getElementById('btn-toggle-camera').classList.toggle('active', !track.enabled); }
}

function toggleSpeakerMute() {
  const remoteVideo = document.getElementById('remote-video');
  remoteVideo.muted = !remoteVideo.muted;
  document.getElementById('btn-toggle-speaker').classList.toggle('active', remoteVideo.muted);
  toast(remoteVideo.muted ? 'Speaker muted' : 'Speaker unmuted', 'info');
}

async function toggleOutputDevice() {
  const remoteVideo = document.getElementById('remote-video');
  if (!remoteVideo.setSinkId) {
    toast('Changing output device not supported in this browser', 'info');
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    if (audioOutputs.length < 2) {
      toast('No other output devices found', 'info');
      return;
    }

    // Simple toggle between first two devices for now
    const currentSinkId = remoteVideo.sinkId || '';
    const nextDevice = audioOutputs.find(d => d.deviceId !== currentSinkId) || audioOutputs[0];
    
    await remoteVideo.setSinkId(nextDevice.deviceId);
    document.getElementById('btn-toggle-output').classList.toggle('active');
    toast(`Output switched to: ${nextDevice.label || 'Next device'}`, 'success');
  } catch (err) {
    console.error(err);
    toast('Error switching output device', 'error');
  }
}

async function startScreenShare() {
  if (state.isScreenSharing) {
    if (state.screenStream) { state.screenStream.getTracks().forEach(t => t.stop()); state.screenStream = null; }
    // Restore video track
    if (state.localStream && state.peerConnection) {
      const videoTrack = state.localStream.getVideoTracks()[0];
      const sender = state.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
        document.getElementById('local-video').srcObject = state.localStream;
      }
    }
    state.isScreenSharing = false;
    document.getElementById('btn-share-screen-call').classList.remove('active');
    return;
  }
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
      video: { frameRate: 15, width: { max: 1280 } }, 
      audio: false 
    });
    const screenTrack = state.screenStream.getVideoTracks()[0];
    if (state.peerConnection) {
      const sender = state.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        // If no video sender exists (audio call), add it
        state.peerConnection.addTrack(screenTrack, state.screenStream);
        // This would require negotiation, which we handle via onnegotiationneeded
      }
    }
    document.getElementById('local-video').srcObject = state.screenStream;
    state.isScreenSharing = true;
    document.getElementById('btn-share-screen-call').classList.add('active');
    screenTrack.onended = () => { if (state.isScreenSharing) startScreenShare(); };
  } catch (err) { 
    console.error(err);
    toast('Screen share failed or cancelled', 'info'); 
  }
}

async function handleIncomingReOffer({ offer }) {
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    state.socket.emit('call-answer', { to: state.callPeer, answer });
  } catch (err) { console.error('Re-offer error:', err); }
}

// ========================
// NETWORK MONITOR
// ========================
function startNetworkMonitor() {
  setInterval(async () => {
    const start = Date.now();
    try {
      await fetch(buildUrl('/api/health'));
      const latency = Date.now() - start;
      let quality = 'good', label = `${latency}ms`;
      if (latency > 300) { quality = 'poor'; label = `Slow (${latency}ms)`; }
      else if (latency > 150) { quality = 'fair'; label = `Fair (${latency}ms)`; }
      else label = `Good (${latency}ms)`;
      const dot = document.querySelector('.quality-dot');
      const text = document.getElementById('network-quality-text');
      if (dot) dot.className = `quality-dot ${quality}`;
      if (text) text.textContent = label;
    } catch { /* offline */ }
  }, 8000);
}

// ========================
// EMOJI PICKER
// ========================
function initEmojis() {
  const grid = document.getElementById('emoji-grid');
  grid.innerHTML = EMOJIS.map(e => `<button class="emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

function insertEmoji(emoji) {
  const input = document.getElementById('message-input');
  input.focus();
  document.execCommand('insertText', false, emoji);
  document.getElementById('emoji-picker').classList.add('hidden');
}

// ========================
// FIND USERS MODAL
// ========================
async function loadSuggested() {
  const res = await api('/api/users/suggested');
  const container = document.getElementById('suggested-users');
  container.innerHTML = (res || []).map(u => renderUserResult(u)).join('');
}

let searchDebounce;
document.getElementById && (() => {
  const input = document.getElementById('user-search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (q.length < 2) {
      document.getElementById('search-results').innerHTML = `<div class="suggested-label">Suggested</div><div id="suggested-users"></div>`;
      loadSuggested();
      return;
    }
    searchDebounce = setTimeout(async () => {
      const results = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      const container = document.getElementById('search-results');
      if (!results?.length) { container.innerHTML = '<div class="empty-state-sm">No users found</div>'; return; }
      container.innerHTML = results.map(u => renderUserResult(u)).join('');
    }, 400);
  });
})();

function renderUserResult(u) {
  let actionHTML = '';
  if (u.relationship === 'contact') {
    actionHTML = `<button class="btn-secondary" onclick="openChat('${u.id}', 'dm');closeModal('find-users-modal')">Chat</button>`;
  } else if (u.relationship === 'request_sent') {
    actionHTML = `<button class="btn-secondary" disabled>Sent</button>`;
  } else if (u.relationship === 'request_received') {
    actionHTML = `<button class="btn-accept" onclick="acceptRequest('${u.request_id}')">Accept</button>`;
  } else {
    actionHTML = `<button class="btn-primary" onclick="sendRequest('${u.id}', this)">Connect</button>`;
  }
  return `<div class="user-result-item">
    <div class="avatar sm">${getAvatar(u)}</div>
    <div class="user-result-info">
      <div class="user-result-name">${escapeHtml(u.display_name)}</div>
      <div class="user-result-username">@${u.username}</div>
    </div>
    <div class="user-result-action">${actionHTML}</div>
  </div>`;
}

async function sendRequest(userId, btn) {
  btn.disabled = true;
  btn.textContent = 'Sending...';
  const res = await api('/api/contacts/request', 'POST', { to_user_id: userId });
  if (res.error) { toast(res.error, 'error'); btn.disabled = false; btn.textContent = 'Connect'; return; }
  btn.textContent = 'Sent ✓';
  btn.className = 'btn-secondary';
  toast('Request sent!', 'success');
}

async function acceptRequest(requestId) {
  const res = await api(`/api/contacts/accept/${requestId}`, 'POST');
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Contact added!', 'success');
  await loadContacts();
  await loadPendingRequests();
  renderRequestsModal();
}

// ========================
// REQUESTS MODAL
// ========================
function renderRequestsModal() {
  const list = document.getElementById('requests-list');
  const reqs = state.pendingRequests || [];
  if (!reqs.length) { list.innerHTML = '<div class="empty-state-sm">No pending requests</div>'; return; }
  list.innerHTML = reqs.map(r => `<div class="request-item" id="req-${r.id}">
    <div class="avatar sm">${r.avatar_value || r.display_name?.charAt(0) || '?'}</div>
    <div class="request-info">
      <div class="request-name">${escapeHtml(r.display_name)}</div>
      <div class="request-msg">@${r.username}${r.message ? ` · "${escapeHtml(r.message)}"` : ''}</div>
    </div>
    <div class="request-actions">
      <button class="btn-accept" onclick="acceptRequest('${r.id}')">Accept</button>
      <button class="btn-reject" onclick="rejectRequest('${r.id}')">Decline</button>
    </div>
  </div>`).join('');
}

async function rejectRequest(requestId) {
  await api(`/api/contacts/reject/${requestId}`, 'POST');
  state.pendingRequests = state.pendingRequests?.filter(r => r.id !== requestId);
  updateRequestsBadge();
  renderRequestsModal();
}

// ========================
// PROFILE EDIT
// ========================
function openProfileModal() {
  const u = state.user;
  document.getElementById('profile-display-name').value = u.display_name;
  document.getElementById('profile-status').value = u.status || 'online';
  document.getElementById('profile-custom-status').value = u.custom_status || '';
  document.getElementById('profile-edit-avatar').textContent = getAvatar(u);
  openModal('profile-modal');
}

async function saveProfile() {
  const display_name = document.getElementById('profile-display-name').value.trim();
  const status = document.getElementById('profile-status').value;
  const custom_status = document.getElementById('profile-custom-status').value.trim();
  const res = await api('/api/users/profile', 'PUT', { display_name, status, custom_status });
  if (res.error) { toast(res.error, 'error'); return; }
  state.user = { ...state.user, ...res };
  updateMyProfile();
  state.socket?.emit('status-update', { status, custom_status });
  closeModal('profile-modal');
  toast('Profile updated!', 'success');
}

// ========================
// GROUPS
// ========================
async function openNewGroupModal() {
  openModal('new-group-modal');
  const container = document.getElementById('group-members-list');
  container.innerHTML = state.contacts.map(c => `
    <label class="group-member-opt">
      <input type="checkbox" value="${c.contact_id}">
      <div class="avatar sm">${getAvatar(c)}</div>
      <span>${escapeHtml(c.display_name)}</span>
    </label>
  `).join('') || '<div class="empty-state-sm">No contacts yet</div>';
}

async function createGroup() {
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { toast('Enter a group name', 'error'); return; }
  const memberIds = Array.from(document.querySelectorAll('#group-members-list input:checked')).map(el => el.value);
  const res = await api('/api/groups/create', 'POST', { name, member_ids: memberIds });
  if (res.error) { toast(res.error, 'error'); return; }
  state.groups.push(res);
  renderContacts();
  closeModal('new-group-modal');
  toast('Group created!', 'success');
  openChat(res.id, 'group');
}

function renderDesktopSupportModal() {
  const contact = getActiveDirectContact();
  const statusEl = document.getElementById('desktop-support-device-status');
  const copyEl = document.getElementById('desktop-support-session-copy');
  const listEl = document.getElementById('desktop-support-device-list');
  const requestBtn = document.getElementById('btn-request-desktop-support');
  const revokeBtn = document.getElementById('btn-revoke-desktop-support');
  const titleEl = document.getElementById('desktop-support-contact-name');

  if (!contact) {
    titleEl.textContent = 'No contact selected';
    statusEl.textContent = 'Open a direct conversation to manage desktop support.';
    copyEl.textContent = 'Desktop support is only available for direct contacts with an online desktop companion.';
    listEl.innerHTML = '';
    requestBtn.disabled = true;
    revokeBtn.classList.add('hidden');
    return;
  }

  const availability = state.supportAvailability[contact.contact_id];
  const session = state.desktopSupportSessions[contact.contact_id];
  const onlineCount = Number(contact.desktop_device_online_count || availability?.online_device_count || 0);

  titleEl.textContent = contact.nickname || contact.display_name || contact.username;
  statusEl.textContent = getDesktopSupportStatusText(contact, session);

  if (session) {
    copyEl.textContent = session.status === 'approved'
      ? 'Approval is complete. The transport layer for the native desktop companion is the next step.'
      : 'Desktop support requests remain explicit, visible, and revocable for both people involved.';
  } else if (onlineCount > 0) {
    copyEl.textContent = 'This contact has an online desktop companion, so you can send a desktop support request that they must explicitly approve.';
  } else {
    copyEl.textContent = 'Desktop Companion Required. This contact needs an online desktop companion before you can request whole-machine support.';
  }

  const devices = availability?.devices || [];
  if (!devices.length) {
    listEl.innerHTML = '<div class="empty-state-sm">No desktop companion devices reported yet.</div>';
  } else {
    listEl.innerHTML = devices.map(device => `
      <div class="desktop-support-device-item">
        <div class="desktop-support-device-meta">
          <div class="desktop-support-device-name">${escapeHtml(device.device_name)}</div>
          <div class="desktop-support-device-subline">${escapeHtml(device.platform)} • Last seen ${formatTime(device.last_seen_at)}</div>
        </div>
        <span class="desktop-support-pill ${device.is_online ? 'online' : 'offline'}">${device.is_online ? 'Online' : 'Offline'}</span>
      </div>
    `).join('');
  }

  requestBtn.disabled = Boolean(session && ['waiting_for_local_approval', 'approved', 'connecting', 'active', 'paused'].includes(session.status)) || onlineCount === 0;
  revokeBtn.classList.toggle('hidden', !(session && ['waiting_for_local_approval', 'approved', 'connecting', 'active', 'paused'].includes(session.status)));
}

async function openDesktopSupportModal() {
  if (!state.activeChat || state.activeChatType !== 'dm') {
    toast('Open a direct conversation first.', 'info');
    return;
  }
  await loadSupportAvailability(state.activeChat);
  await loadDesktopSupportSessions(state.activeChat);
  renderDesktopSupportModal();
  openModal('desktop-support-modal');
}

async function requestDesktopSupport() {
  const contact = getActiveDirectContact();
  if (!contact) return;

  const res = await api('/api/support-sessions', 'POST', { target_user_id: contact.contact_id });
  if (res?.error) {
    toast(res.error, 'error');
    return;
  }

  applyDesktopSupportSession(res);
  renderDesktopSupportModal();
  updateDesktopSupportHeader(contact);
  toast(`Desktop support request sent to ${contact.nickname || contact.display_name}.`, 'success');
}

async function revokeDesktopSupport() {
  const contact = getActiveDirectContact();
  const session = contact ? state.desktopSupportSessions[contact.contact_id] : null;
  if (!session) return;

  const res = await api(`/api/support-sessions/${session.id}/revoke`, 'POST');
  if (res?.error) {
    toast(res.error, 'error');
    return;
  }

  applyDesktopSupportSession(res);
  renderDesktopSupportModal();
  updateDesktopSupportHeader(contact);
  toast('Desktop support session revoked.', 'info');
}

async function approveIncomingDesktopSupport() {
  const session = state.incomingDesktopSupportSession;
  if (!session) return;

  const res = await api(`/api/support-sessions/${session.id}/approve`, 'POST');
  if (res?.error) {
    toast(res.error, 'error');
    return;
  }

  state.incomingDesktopSupportSession = null;
  applyDesktopSupportSession(res);
  closeModal('desktop-support-request-modal');
  renderDesktopSupportModal();
  toast('Desktop support approved. Companion connection is ready for the native layer.', 'success');
}

async function denyIncomingDesktopSupport() {
  const session = state.incomingDesktopSupportSession;
  if (!session) return;

  const res = await api(`/api/support-sessions/${session.id}/deny`, 'POST');
  if (res?.error) {
    toast(res.error, 'error');
    return;
  }

  state.incomingDesktopSupportSession = null;
  applyDesktopSupportSession(res);
  closeModal('desktop-support-request-modal');
  renderDesktopSupportModal();
  toast('Desktop support request denied.', 'info');
}

// ========================
// MODALS
// ========================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ========================
// THEME
// ========================
function initTheme() {
  const saved = localStorage.getItem('echolink_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('echolink_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  document.getElementById('theme-icon-moon').classList.toggle('hidden', theme === 'light');
  document.getElementById('theme-icon-sun').classList.toggle('hidden', theme === 'dark');
}

// ========================
// KEYBOARD SHORTCUTS
// ========================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'k') { e.preventDefault(); openModal('find-users-modal'); loadSuggested(); }
    if (e.key === 'Escape') {
      endCall(true);
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement === document.getElementById('message-input')) {
      e.preventDefault(); sendMessage();
    }
  });
}

// ========================
// HELPERS
// ========================
function showMsgActions(el) {
  // Handled via CSS hover
}

// ========================
// INIT EVENT LISTENERS
// ========================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTheme();

  // If already logged in
  if (state.token) {
    api('/api/contacts/list').then(r => {
      if (!r.error && r) {
        // Validate token by fetching profile
        fetch(buildUrl('/api/contacts/list'), { headers: { 'Authorization': `Bearer ${state.token}` } })
          .then(res => {
            if (res.ok) {
              // Decode token to get user info
              try {
                const payload = JSON.parse(atob(state.token.split('.')[1]));
                // We need full user data
                api('/api/users/search?q=_placeholder_').then(() => {
                  // Just check the token is valid; we need to reconstruct user
                  // Store user info alongside token
                  const savedUser = localStorage.getItem('echolink_user');
                  if (savedUser) { state.user = JSON.parse(savedUser); startApp(); }
                  else { localStorage.removeItem('echolink_token'); }
                });
              } catch { localStorage.removeItem('echolink_token'); }
            } else { localStorage.removeItem('echolink_token'); }
          });
      }
    });
  }

  // Buttons
  document.getElementById('btn-send').addEventListener('click', sendMessage);
  document.getElementById('btn-attach').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', handleFileSelect);
  document.getElementById('btn-emoji').addEventListener('click', () => document.getElementById('emoji-picker').classList.toggle('hidden'));
  document.getElementById('btn-voice-msg').addEventListener('click', startRecording);
  document.getElementById('stop-recording').addEventListener('click', stopRecording);
  document.getElementById('cancel-recording').addEventListener('click', () => {
    if (state.mediaRecorder) { state.mediaRecorder.stream.getTracks().forEach(t => t.stop()); state.mediaRecorder = null; }
    clearInterval(state.recordingTimer);
    document.getElementById('voice-recording-ui').classList.add('hidden');
  });

  document.getElementById('message-input').addEventListener('input', handleTyping);
  document.getElementById('cancel-reply').addEventListener('click', clearReply);

  document.getElementById('btn-audio-call').addEventListener('click', () => startCall('audio'));
  document.getElementById('btn-video-call').addEventListener('click', () => startCall('video'));
  document.getElementById('btn-screen-share').addEventListener('click', () => {
    if (!state.activeChat) { toast('Start a call first', 'info'); return; }
    startCall('video').then(() => startScreenShare());
  });
  document.getElementById('btn-desktop-support').addEventListener('click', openDesktopSupportModal);
  document.getElementById('btn-toggle-mute').addEventListener('click', toggleMute);
  document.getElementById('btn-toggle-camera').addEventListener('click', toggleCamera);
  document.getElementById('btn-toggle-speaker').addEventListener('click', toggleSpeakerMute);
  document.getElementById('btn-toggle-output').addEventListener('click', toggleOutputDevice);
  document.getElementById('btn-end-call').addEventListener('click', () => endCall(true));
  document.getElementById('btn-share-screen-call').addEventListener('click', startScreenShare);
  document.getElementById('btn-request-desktop-support').addEventListener('click', requestDesktopSupport);
  document.getElementById('btn-revoke-desktop-support').addEventListener('click', revokeDesktopSupport);
  document.getElementById('btn-refresh-desktop-support').addEventListener('click', async () => {
    if (state.activeChat && state.activeChatType === 'dm') {
      await loadContacts();
      await loadSupportAvailability(state.activeChat);
      await loadDesktopSupportSessions(state.activeChat);
      renderDesktopSupportModal();
    }
  });
  document.getElementById('btn-approve-desktop-support').addEventListener('click', approveIncomingDesktopSupport);
  document.getElementById('btn-deny-desktop-support').addEventListener('click', denyIncomingDesktopSupport);

  document.getElementById('btn-minimize-call').addEventListener('click', () => {
    document.getElementById('call-panel').classList.toggle('minimized');
    toast(document.getElementById('call-panel').classList.contains('minimized') ? 'Call minimized' : 'Call restored', 'info');
  });

  document.getElementById('btn-fullscreen-call').addEventListener('click', () => {
    const cp = document.getElementById('call-panel');
    if (cp.classList.contains('fullscreen')) {
      cp.classList.remove('fullscreen');
      document.exitFullscreen?.().catch(() => {});
    } else {
      cp.classList.add('fullscreen');
      cp.requestFullscreen?.().catch(() => {
        // Fallback to "wide" mode via CSS if browser blocks fullscreen
        cp.classList.add('wide-mode');
      });
    }
  });

  document.getElementById('btn-accept-call').addEventListener('click', acceptCall);
  document.getElementById('btn-reject-call').addEventListener('click', () => {
    if (state.pendingCall) state.socket?.emit('call-reject', { to: state.pendingCall.from });
    document.getElementById('incoming-call-modal').classList.add('hidden');
  });

  document.getElementById('btn-find-users').addEventListener('click', () => { openModal('find-users-modal'); loadSuggested(); });
  document.getElementById('btn-requests').addEventListener('click', () => { openModal('requests-modal'); renderRequestsModal(); });
  document.getElementById('btn-new-group').addEventListener('click', openNewGroupModal);
  document.getElementById('btn-edit-profile').addEventListener('click', openProfileModal);
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-create-group').addEventListener('click', createGroup);
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('echolink_token');
    localStorage.removeItem('echolink_user');
    state.socket?.disconnect();
    location.reload();
  });

  document.getElementById('contact-search').addEventListener('input', renderContacts);
  document.getElementById('chat-back-btn').addEventListener('click', () => {
    document.getElementById('panel-left').classList.remove('hidden-mobile');
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('chat-empty').classList.remove('hidden');
    state.activeChat = null;
    updateDesktopSupportHeader(null);
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      // Logic: If click is on the overlay itself AND it's NOT the incoming call modal, hide it.
      if (e.target === overlay && overlay.id !== 'incoming-call-modal') {
        overlay.classList.add('hidden');
      }
    });
  });

  // Close emoji picker outside click
  document.addEventListener('click', e => {
    const picker = document.getElementById('emoji-picker');
    if (!picker.classList.contains('hidden') && !e.target.closest('#emoji-picker') && !e.target.closest('#btn-emoji')) {
      picker.classList.add('hidden');
    }
  });
});

// Patch: save user on login/register
const origStartApp = startApp;
window.startApp = function() {
  if (state.user) localStorage.setItem('echolink_user', JSON.stringify(state.user));
  return origStartApp();
};

// ========================
// REMOTE SUPPORT LOGIC
// ========================
function setupDataChannel() {
  state.dataChannel.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'pointer' || data.type === 'remote-move') updateRemotePointer(data);
    if (data.type === 'remote-click') handleRemoteClick(data);
    if (data.type === 'remote-key') handleRemoteKey(data);
  };
}

function handleRemoteClick({ x, y }) {
  // Since we are in a browser, we simulate a click at the coordinates
  // Note: Only works effectively if the user is sharing the EchoLink tab itself
  const el = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
  if (el) {
    el.click();
    el.focus();
    // Visual feedback on the controlled side
    const ripple = document.createElement('div');
    ripple.className = 'remote-click-ripple';
    ripple.style.left = (x * 100) + '%';
    ripple.style.top = (y * 100) + '%';
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }
}

function handleRemoteKey({ key, ctrlKey, shiftKey, altKey }) {
  // Simulate keyboard interaction
  console.log('Remote Key Received:', key);
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.getAttribute('contenteditable'))) {
    if (key.length === 1) {
      document.execCommand('insertText', false, key);
    } else if (key === 'Backspace') {
      document.execCommand('delete');
    } else if (key === 'Enter') {
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
      active.dispatchEvent(event);
    }
  }
}

function updateRemotePointer({ x, y }) {
  let cursor = document.getElementById('remote-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = 'remote-cursor';
    cursor.className = 'remote-cursor';
    cursor.innerHTML = '🖱️';
    document.getElementById('call-videos').appendChild(cursor);
  }
  cursor.style.left = (x * 100) + '%';
  cursor.style.top = (y * 100) + '%';
}

function sendSupportEvent(type, e) {
  if (!state.dataChannel || state.dataChannel.readyState !== 'open') return;
  const rect = document.getElementById('remote-video').getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  state.dataChannel.send(JSON.stringify({ type, x, y }));
}

document.getElementById('floating-call-btn').addEventListener('click', () => {
  showCallPanel(state.callType);
});

// Sync floating button visibility
function updateFloatingCallButton() {
  const btn = document.getElementById('floating-call-btn');
  const panelHidden = document.getElementById('panel-right').classList.contains('hidden');
  if (state.callPeer && panelHidden) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// Add to a small interval or hook into panel transitions
setInterval(updateFloatingCallButton, 1000);

async function requestRemoteSupport() {
  if (!state.callPeer) return;
  if (state.isRemoteControlled) {
    toast('Remote support is already active. Use Stop Access if you want to revoke it.', 'info');
    return;
  }
  if (state.isRemoteSupporter) {
    endRemoteSupport(true);
    toast('Remote support ended for this session.', 'info');
    return;
  }

  state.socket.emit('remote-support-request', { to: state.callPeer });
  toast('Support request sent. The other person must review and approve it first.', 'info');
}

// Bind support button
document.getElementById('btn-remote-support')?.addEventListener('click', requestRemoteSupport);

document.getElementById('remote-support-consent').addEventListener('change', (e) => {
  document.getElementById('btn-allow-remote').disabled = !e.target.checked;
});

document.getElementById('btn-allow-remote').addEventListener('click', () => {
  const targetId = state.pendingRemoteSupportRequester || state.callPeer;
  if (!targetId) return;
  state.isRemoteControlled = true;
  state.isRemoteSupporter = false;
  state.remoteSupportPeerId = targetId;
  state.pendingRemoteSupportRequester = null;
  state.socket.emit('remote-support-granted', { to: targetId });
  closeModal('remote-access-modal');
  updateRemoteSupportUI();
  toast(`${getContactDisplayName(targetId)} can now provide support in this EchoLink session.`, 'success');
});

document.getElementById('btn-deny-remote').addEventListener('click', () => {
  const targetId = state.pendingRemoteSupportRequester || state.callPeer;
  if (targetId) state.socket.emit('remote-support-denied', { to: targetId });
  state.pendingRemoteSupportRequester = null;
  state.remoteSupportPeerId = state.isRemoteControlled || state.isRemoteSupporter ? state.remoteSupportPeerId : null;
  document.getElementById('remote-support-consent').checked = false;
  document.getElementById('btn-allow-remote').disabled = true;
  closeModal('remote-access-modal');
  toast('Remote support request denied.', 'info');
});

document.getElementById('btn-stop-remote-support').addEventListener('click', () => {
  if (!state.isRemoteControlled) return;
  const peerName = getContactDisplayName(state.remoteSupportPeerId || state.callPeer);
  endRemoteSupport(true);
  toast(`Remote support from ${peerName} has been stopped.`, 'info');
});

updateRemoteSupportUI();

document.getElementById('remote-video').addEventListener('mousemove', (e) => {
  if (state.isRemoteSupporter) {
    sendSupportEvent('remote-move', e);
  }
});

document.getElementById('remote-video').addEventListener('click', (e) => {
  if (state.isRemoteSupporter) {
    sendSupportEvent('remote-click', e);
    
    // Local feedback for supporter
    const ripple = document.createElement('div');
    ripple.className = 'remote-click-ripple';
    const rect = e.target.getBoundingClientRect();
    ripple.style.left = (((e.clientX - rect.left) / rect.width) * 100) + '%';
    ripple.style.top = (((e.clientY - rect.top) / rect.height) * 100) + '%';
    e.target.parentElement.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }
});

window.addEventListener('keydown', (e) => {
  if (state.isRemoteSupporter && state.peerConnection) {
    // Only send if we are actively supporting and controlling
    const ignoreKeys = ['Control', 'Shift', 'Alt', 'Meta'];
    if (!ignoreKeys.includes(e.key)) {
      state.dataChannel?.send(JSON.stringify({
        type: 'remote-key',
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey
      }));
    }
  }
});
window.addEventListener('load', () => {
  if (state.token) {
    const savedUser = localStorage.getItem('echolink_user');
    if (savedUser) {
      state.user = JSON.parse(savedUser);
      // Verify token
      fetch(buildUrl('/api/contacts/list'), { headers: { 'Authorization': `Bearer ${state.token}` } })
        .then(r => { if (r.ok) { window.startApp(); } else { localStorage.removeItem('echolink_token'); localStorage.removeItem('echolink_user'); } })
        .catch(() => {});
    }
  }
});
