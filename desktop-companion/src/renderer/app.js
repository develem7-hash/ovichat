const STORAGE_KEY = 'echolink-desktop-companion';

const state = {
  config: {
    serverUrl: '',
    token: '',
    deviceId: '',
    deviceName: '',
    platform: ''
  },
  deviceInfo: null,
  sessions: [],
  pollTimer: null
};

function $(id) {
  return document.getElementById(id);
}

function loadConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.config = { ...state.config, ...parsed };
  } catch (_) {
    state.config = { ...state.config };
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function showToast(message, type = 'info') {
  const host = $('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function formatTime(ts) {
  if (!ts) return 'Unknown';
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateForm() {
  $('server-url').value = state.config.serverUrl || state.deviceInfo?.defaultServerUrl || '';
  $('auth-token').value = state.config.token || '';
  $('device-name-input').value = state.config.deviceName || state.deviceInfo?.deviceName || '';
  $('device-platform-input').value = state.config.platform || state.deviceInfo?.platform || '';

  $('device-name').textContent = state.config.deviceName || state.deviceInfo?.deviceName || 'Unknown device';
  $('device-platform').textContent = state.config.platform || state.deviceInfo?.platform || '';
  $('companion-connection-state').textContent = state.config.deviceId ? 'Configured' : 'Offline';
  $('companion-register-state').textContent = state.config.deviceId
    ? `Registered device id ${state.config.deviceId}`
    : 'Register this companion to start receiving desktop support requests.';
}

function readForm() {
  state.config.serverUrl = $('server-url').value.trim().replace(/\/+$/, '');
  state.config.token = $('auth-token').value.trim();
  state.config.deviceName = $('device-name-input').value.trim();
  state.config.platform = $('device-platform-input').value.trim();
  saveConfig();
}

async function api(path, method = 'GET', body = null) {
  readForm();
  const response = await fetch(`${state.config.serverUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.config.token}`
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function sessionCard(session, withActions) {
  const wrapper = document.createElement('div');
  wrapper.className = 'session-card';
  wrapper.innerHTML = `
    <div class="session-title-row">
      <div class="session-name">${session.peer_display_name || session.peer_username || 'Unknown user'}</div>
      <span class="status-pill ${session.status}">${session.status.replaceAll('_', ' ')}</span>
    </div>
    <div class="session-meta">Requested ${formatTime(session.requested_at)}${session.target_device_name ? ` • ${session.target_device_name}` : ''}</div>
  `;

  if (withActions) {
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    actions.style.marginTop = '14px';

    const deny = document.createElement('button');
    deny.className = 'btn-secondary';
    deny.textContent = 'Deny';
    deny.addEventListener('click', () => denySession(session.id));

    const approve = document.createElement('button');
    approve.className = 'btn-primary';
    approve.textContent = 'Approve';
    approve.addEventListener('click', () => approveSession(session.id));

    actions.appendChild(deny);
    actions.appendChild(approve);
    wrapper.appendChild(actions);
  }

  return wrapper;
}

function renderSessions() {
  const pendingHost = $('pending-sessions');
  const recentHost = $('recent-sessions');
  const pending = state.sessions.filter(session => session.status === 'waiting_for_local_approval' && !session.is_requester);
  const recent = state.sessions.slice(0, 8);

  $('pending-count').textContent = `${pending.length} pending`;

  pendingHost.innerHTML = '';
  if (!pending.length) {
    pendingHost.innerHTML = '<div class="empty-state">No pending support requests.</div>';
  } else {
    pending.forEach(session => pendingHost.appendChild(sessionCard(session, true)));
  }

  recentHost.innerHTML = '';
  if (!recent.length) {
    recentHost.innerHTML = '<div class="empty-state">No desktop support sessions yet.</div>';
  } else {
    recent.forEach(session => {
      const card = sessionCard(session, false);
      if (['approved', 'active', 'connecting', 'paused', 'waiting_for_local_approval'].includes(session.status)) {
        const actions = document.createElement('div');
        actions.className = 'session-actions';
        actions.style.marginTop = '14px';
        const revoke = document.createElement('button');
        revoke.className = 'btn-secondary';
        revoke.textContent = 'Revoke';
        revoke.addEventListener('click', () => revokeSession(session.id));
        actions.appendChild(revoke);
        card.appendChild(actions);
      }
      recentHost.appendChild(card);
    });
  }
}

async function registerDevice() {
  try {
    readForm();
    if (!state.config.serverUrl || !state.config.token || !state.config.deviceName || !state.config.platform) {
      showToast('Server URL, token, device name, and platform are required.', 'error');
      return;
    }

    const res = await api('/api/devices/register', 'POST', {
      device_id: state.config.deviceId || undefined,
      device_name: state.config.deviceName,
      platform: state.config.platform,
      capabilities: state.deviceInfo?.capabilities || {}
    });

    state.config.deviceId = res.id;
    saveConfig();
    updateForm();
    await refreshSessions();
    ensurePolling();
    showToast('Desktop companion registered successfully.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function sendHeartbeat(silent = false) {
  try {
    readForm();
    if (!state.config.deviceId) {
      if (!silent) showToast('Register the companion first.', 'error');
      return;
    }
    await api(`/api/devices/${state.config.deviceId}/heartbeat`, 'POST');
    updateForm();
    if (!silent) showToast('Heartbeat sent.', 'success');
  } catch (error) {
    if (!silent) showToast(error.message, 'error');
  }
}

async function markOffline() {
  try {
    readForm();
    if (!state.config.deviceId) {
      showToast('Register the companion first.', 'error');
      return;
    }
    await api(`/api/devices/${state.config.deviceId}/offline`, 'POST');
    showToast('Device marked offline.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function refreshSessions(silent = false) {
  try {
    readForm();
    if (!state.config.serverUrl || !state.config.token) return;
    const sessions = await api('/api/support-sessions?limit=12');
    state.sessions = Array.isArray(sessions) ? sessions : [];
    renderSessions();
  } catch (error) {
    if (!silent) showToast(error.message, 'error');
  }
}

async function approveSession(sessionId) {
  try {
    await api(`/api/support-sessions/${sessionId}/approve`, 'POST');
    await refreshSessions();
    showToast('Desktop support approved.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function denySession(sessionId) {
  try {
    await api(`/api/support-sessions/${sessionId}/deny`, 'POST');
    await refreshSessions();
    showToast('Desktop support denied.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function revokeSession(sessionId) {
  try {
    await api(`/api/support-sessions/${sessionId}/revoke`, 'POST');
    await refreshSessions();
    showToast('Desktop support revoked.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function ensurePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    refreshSessions(true);
    if (state.config.deviceId) sendHeartbeat(true);
  }, 15000);
}

async function init() {
  loadConfig();
  state.deviceInfo = await window.companionAPI.getDeviceInfo();

  state.config.serverUrl = state.config.serverUrl || state.deviceInfo.defaultServerUrl;
  state.config.deviceName = state.config.deviceName || state.deviceInfo.deviceName;
  state.config.platform = state.config.platform || `${state.deviceInfo.platform} • ${state.deviceInfo.arch}`;
  saveConfig();
  updateForm();
  renderSessions();

  $('btn-register').addEventListener('click', registerDevice);
  $('btn-heartbeat').addEventListener('click', sendHeartbeat);
  $('btn-mark-offline').addEventListener('click', markOffline);
  $('btn-refresh-sessions').addEventListener('click', refreshSessions);

  if (state.config.serverUrl && state.config.token) {
    await refreshSessions();
    if (state.config.deviceId) ensurePolling();
  }
}

window.addEventListener('beforeunload', () => {
  if (state.pollTimer) clearInterval(state.pollTimer);
});

window.addEventListener('DOMContentLoaded', init);
