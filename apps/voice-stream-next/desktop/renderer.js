const desktop = window.voiceStreamDesktop;

const PRE_ROLL_MAX_BYTES = pcmBytesForMs(1500);
const MAX_PENDING_STREAM_BYTES = pcmBytesForMs(5000);
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_EXPONENT = 4;

const preRollBuffer = new PcmCaptureBuffer(PRE_ROLL_MAX_BYTES);
const pendingStreamBuffer = new PcmCaptureBuffer(MAX_PENDING_STREAM_BYTES);

const state = {
  config: null,
  dashboard: null,
  activeThreadId: null,
  stream: null,
  audioContext: null,
  processor: null,
  voiceSocket: null,
  voiceOutgoingReady: false,
  voiceReconnectAttempt: 0,
  voiceReconnecting: false,
  voiceReconnectTimer: null,
  voiceFinalizeTimer: null,
  voicePostStopMode: 'awake',
  voicePostStopStatus: '',
  desktopAuthPollTimer: null,
  voiceStreamEnding: false,
  wakeUsesVosk: false,
  controlSocket: null,
  voiceSessionId: null,
  voiceTarget: 'assistant',
  mode: 'off',
  voiceSettings: null,
  recognition: null,
  wakeStream: null,
  wakeAudioContext: null,
  wakeProcessor: null,
  wakeUnsubscribe: null,
  wakeStarting: false,
  lastRecognizedText: '',
  lastRecognizedAt: 0,
  approvalRecognizer: new ApprovalCodeRecognizer(),
  approvalFinalizeTimer: null,
  analyser: null,
  meterFrame: 0,
  compact: true,
  signedOutExpandInFlight: false,
};

const els = {
  connectionDot: document.querySelector('#connectionDot'),
  connectionLabel: document.querySelector('#connectionLabel'),
  deviceLabel: document.querySelector('#deviceLabel'),
  accountLabel: document.querySelector('#accountLabel'),
  accountDetail: document.querySelector('#accountDetail'),
  openWebButton: document.querySelector('#openWebButton'),
  signInButton: document.querySelector('#signInButton'),
  signOutButton: document.querySelector('#signOutButton'),
  authCloseButton: document.querySelector('#authCloseButton'),
  compactButton: document.querySelector('#compactButton'),
  closeButton: document.querySelector('#closeButton'),
  expandButton: document.querySelector('#expandButton'),
  saveButton: document.querySelector('#saveButton'),
  serverUrlInput: document.querySelector('#serverUrlInput'),
  deviceNameInput: document.querySelector('#deviceNameInput'),
  authStatus: document.querySelector('#authStatus'),
  pairingMessage: document.querySelector('#pairingMessage'),
  voiceAuthStatus: document.querySelector('#voiceAuthStatus'),
  voicePairingMessage: document.querySelector('#voicePairingMessage'),
  pairButton: document.querySelector('#pairButton'),
  primaryVoiceButton: document.querySelector('#primaryVoiceButton'),
  primaryVoiceMode: document.querySelector('#primaryVoiceMode'),
  primaryVoiceAction: document.querySelector('#primaryVoiceAction'),
  offButton: document.querySelector('#offButton'),
  micStatus: document.querySelector('#micStatus'),
  meterBar: document.querySelector('#meterBar'),
  inputDeviceSelect: document.querySelector('#inputDeviceSelect'),
  outputDeviceSelect: document.querySelector('#outputDeviceSelect'),
  inputDeviceButton: document.querySelector('#inputDeviceButton'),
  inputDeviceLabel: document.querySelector('#inputDeviceLabel'),
  inputDeviceMenu: document.querySelector('#inputDeviceMenu'),
  outputDeviceButton: document.querySelector('#outputDeviceButton'),
  outputDeviceLabel: document.querySelector('#outputDeviceLabel'),
  outputDeviceMenu: document.querySelector('#outputDeviceMenu'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
};

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function debugWindow(message, details = {}) {
  if (!desktop.debugWindow) return;
  void desktop.debugWindow(message, {
    ...details,
    bodyClass: document.body.className,
    compact: state.compact,
    signedOutExpandInFlight: state.signedOutExpandInFlight,
    hasDeviceId: Boolean(state.config?.deviceId),
    hasDeviceToken: Boolean(state.config?.deviceToken),
    installationId: state.config?.installationId || '',
  }).catch(() => undefined);
}

function deriveWebUrl(config) {
  if (config.webUrl) return trimSlash(config.webUrl);
  const serverUrl = trimSlash(config.serverUrl);
  if (!serverUrl) return '';
  try {
    const url = new URL(serverUrl);
    if (url.port === '3299') {
      url.port = '5185';
      return trimSlash(url.toString());
    }
  } catch {
    // Fall back to the server URL when it is not a valid absolute URL.
  }
  return serverUrl;
}

function authSessionFields(config) {
  const next = { ...config };
  if (next.authMode === 'bearer' && next.bearerToken) {
    next.authSavedAt = new Date().toISOString();
  }
  if (next.authMode !== 'bearer') {
    next.authSavedAt = '';
  }
  return next;
}

function updateAuthStatus(kind, message) {
  if (els.authStatus) {
    els.authStatus.className = `auth-status ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : 'muted'}`;
    els.authStatus.textContent = message;
  }
  if (els.voiceAuthStatus) {
    els.voiceAuthStatus.className = `auth-status ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : 'muted'}`;
    els.voiceAuthStatus.textContent = message;
  }
}

function authGuidance(config) {
  const webUrl = deriveWebUrl(config);
  return webUrl
    ? `Sign in at ${webUrl}, then connect this desktop.`
    : 'Sign in on the web dashboard, then connect this desktop.';
}

function showPairingMessage(message, kind = 'muted') {
  if (els.pairingMessage) {
    els.pairingMessage.textContent = message;
    els.pairingMessage.className = kind === 'error' ? 'error' : 'muted';
  }
  if (els.voicePairingMessage) {
    els.voicePairingMessage.textContent = message;
    els.voicePairingMessage.className = kind === 'error' ? 'error' : 'muted';
  }
}

function setPreferredOutputDevice(deviceId) {
  window.voiceStreamPreferredOutputDeviceId = String(deviceId || '');
}

function readFormConfig() {
  return {
    ...state.config,
    serverUrl: trimSlash(els.serverUrlInput?.value || state.config?.serverUrl),
    deviceName: els.deviceNameInput?.value.trim() || state.config?.deviceName || 'Desktop voice client',
    inputDeviceId: els.inputDeviceSelect?.value ?? state.config?.inputDeviceId ?? '',
    outputDeviceId: els.outputDeviceSelect?.value ?? state.config?.outputDeviceId ?? '',
  };
}

function applyConfig(config) {
  state.config = config;
  if (els.serverUrlInput) els.serverUrlInput.value = config.serverUrl;
  if (els.deviceNameInput) els.deviceNameInput.value = config.deviceName;
  if (els.inputDeviceSelect) els.inputDeviceSelect.value = config.inputDeviceId || '';
  if (els.outputDeviceSelect) els.outputDeviceSelect.value = config.outputDeviceId || '';
  renderDevicePicker(els.inputDeviceSelect);
  renderDevicePicker(els.outputDeviceSelect);
  setPreferredOutputDevice(config.outputDeviceId);
  const connected = Boolean(config.deviceId && config.deviceToken);
  document.body.classList.toggle('is-signed-in', connected);
  document.body.classList.toggle('is-signed-out', !connected);
  document.body.classList.toggle('is-compact', connected && state.compact);
  els.compactButton.hidden = state.compact || !connected;
  els.expandButton.hidden = !state.compact || !connected;
  debugWindow('renderer:applyConfig', {
    connected,
    deviceId: config.deviceId ? `${config.deviceId.slice(0, 12)}...` : '',
    hasDeviceToken: Boolean(config.deviceToken),
    serverUrl: config.serverUrl,
  });
  if (!connected) ensureSignedOutWindowExpanded();
  updateConnection('idle', config.deviceId ? 'Desktop connected' : 'Ready', config.deviceId ? `${config.deviceName} · ${config.deviceId.slice(0, 12)}` : 'No device connected');
  if (els.accountLabel) els.accountLabel.textContent = connected ? 'Connected' : 'Signed out';
  if (els.accountDetail) els.accountDetail.textContent = connected ? config.deviceName : 'Sign in required';
  if (connected) {
    updateAuthStatus('ok', 'Desktop connected.');
  } else {
    updateAuthStatus('idle', 'Sign in with your browser to connect this desktop.');
  }
}

function headers() {
  const config = readFormConfig();
  const next = { 'content-type': 'application/json' };
  if (config.authMode === 'bearer' && config.bearerToken) {
    next.authorization = `Bearer ${config.bearerToken}`;
  } else {
    next['x-voice-dev-user-email'] = config.devEmail || 'desktop@example.local';
    next['x-voice-dev-user-name'] = config.devName || 'Desktop Operator';
    next['x-voice-dev-admin'] = '0';
  }
  return next;
}

async function api(path, init = {}) {
  const config = readFormConfig();
  const response = await fetch(`${trimSlash(config.serverUrl)}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const err = new Error(body?.error || `${response.status} ${response.statusText}`);
    err.statusCode = response.status;
    if (response.status === 401 || response.status === 403) {
      err.authFailure = true;
      updateAuthStatus('error', `Auth failed (${response.status}). ${authGuidance(config)}`);
    }
    throw err;
  }
  if (config.authMode === 'bearer' && config.bearerToken) {
    updateAuthStatus('ok', `Signed in${config.authSavedAt ? ` · ${new Date(config.authSavedAt).toLocaleString()}` : ''}.`);
  } else if (config.authMode === 'dev') {
    updateAuthStatus('ok', 'Connected to local development server.');
  }
  return body;
}

function updateConnection(kind, label, detail) {
  els.connectionDot.className = `dot ${kind}`;
  els.connectionLabel.textContent = label;
  els.deviceLabel.textContent = detail;
}

function showStatus(message) {
  els.micStatus.textContent = message;
}

function ensureSignedOutWindowExpanded() {
  if (state.config?.deviceId && state.config?.deviceToken) return;
  const resizeWindow = desktop.signedOutWindow || desktop.expandWindow;
  debugWindow('renderer:ensureSignedOutWindowExpanded', {
    hasSignedOutWindow: Boolean(desktop.signedOutWindow),
    hasExpandWindow: Boolean(desktop.expandWindow),
    skipped: !resizeWindow || state.signedOutExpandInFlight,
  });
  if (!resizeWindow || state.signedOutExpandInFlight) return;
  state.signedOutExpandInFlight = true;
  void resizeWindow()
    .then(applyWindowState)
    .finally(() => {
      state.signedOutExpandInFlight = false;
    });
}

function applyWindowState(windowState) {
  state.compact = Boolean(windowState?.compact);
  const canCompact = Boolean(state.config?.deviceId && state.config?.deviceToken);
  document.body.classList.toggle('is-compact', state.compact && canCompact);
  els.compactButton.hidden = state.compact || !canCompact;
  els.expandButton.hidden = !state.compact || !canCompact;
  debugWindow('renderer:applyWindowState', { windowState, canCompact });
  if (!canCompact) ensureSignedOutWindowExpanded();
}

function setMode(mode, status) {
  state.mode = mode;
  if (status) showStatus(status);
  updateVoiceButtons();
  if (desktop.setTrayStatus) {
    void desktop.setTrayStatus({ mode, status: status || els.micStatus.textContent || mode }).catch(() => undefined);
  }
  void reportClientStatus(mode, status || els.micStatus.textContent || mode);
}

async function reportClientStatus(mode, status) {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  if (state.controlSocket?.readyState === WebSocket.OPEN) {
    state.controlSocket.send(JSON.stringify({
      type: 'client_status',
      mode,
      status,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
      reportedAt: new Date().toISOString(),
    }));
    return;
  }
  ensureControlSocket();
  await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/status`, {
    method: 'POST',
    body: JSON.stringify({
      token: state.config.deviceToken,
      mode,
      status,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
    }),
  }).catch(() => undefined);
}

function ensureControlSocket() {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  if (state.controlSocket && state.controlSocket.readyState <= WebSocket.OPEN) return;
  const url = new URL(`/api/devices/${encodeURIComponent(state.config.deviceId)}/control`, trimSlash(state.config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', state.config.deviceToken);
  const socket = new WebSocket(url.toString());
  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'client_status',
      mode: state.mode,
      status: els.micStatus.textContent || state.mode,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
      reportedAt: new Date().toISOString(),
    }));
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.type === 'server_ping') {
      socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      return;
    }
    if (message.type === 'speech_audio') {
      playWavBase64(message.audioBase64);
      return;
    }
    if (message.type === 'server_command') {
      handleRemoteControlCommand(message, socket);
    }
  };
  socket.onclose = () => {
    if (state.controlSocket === socket) state.controlSocket = null;
  };
  socket.onerror = () => {
    if (state.controlSocket === socket) state.controlSocket = null;
  };
  state.controlSocket = socket;
}

function handleRemoteControlCommand(message, socket) {
  const command = String(message?.command ?? '');
  const commandId = String(message?.commandId ?? '');
  const ack = (payload) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'command_ack', commandId, command, ...payload }));
  };
  try {
    if (command === 'query_status') {
      ack({ ok: true, mode: state.mode, status: els.micStatus.textContent || state.mode });
      void reportClientStatus(state.mode, els.micStatus.textContent || state.mode);
      return;
    }
    if (command === 'sleep') {
      void enterSleep().then(() => ack({ ok: true, mode: 'sleeping', status: els.micStatus.textContent || 'Sleeping.' }));
      return;
    }
    if (command === 'off') {
      void turnOff().then(() => ack({ ok: true, mode: 'off', status: 'Off.' }));
      return;
    }
    if (command === 'awake') {
      enterAwake();
      ack({ ok: true, mode: 'awake', status: els.micStatus.textContent || 'Awake.' });
      return;
    }
    ack({ ok: false, error: 'unknown command' });
  } catch (err) {
    ack({ ok: false, error: err?.message ?? String(err) });
  }
}

function updateVoiceButtons() {
  const streaming = Boolean(state.voiceSocket || state.stream);
  const labels = {
    off: ['Off', 'Start voice'],
    awake: ['Awake', 'Sleep'],
    sleeping: ['Sleeping', 'Wake'],
    recording: ['Recording', 'Stop'],
    transcribing: ['Working', 'Please wait'],
    error: ['Voice error', 'Retry'],
  };
  const [modeLabel, actionLabel] = labels[state.mode] || ['Voice', 'Toggle'];
  els.primaryVoiceMode.textContent = modeLabel;
  els.primaryVoiceAction.textContent = actionLabel;
  els.primaryVoiceButton.disabled = state.mode === 'transcribing';
  els.primaryVoiceButton.className = `voice-orb is-${state.mode}`;
  els.primaryVoiceButton.setAttribute('aria-label', `${actionLabel} desktop voice`);
  els.primaryVoiceButton.setAttribute('aria-pressed', String(streaming || state.mode === 'awake'));
  els.offButton.hidden = state.mode === 'off';
  els.offButton.disabled = state.mode === 'transcribing';
}

function clearVoiceReconnectTimer() {
  if (state.voiceReconnectTimer) {
    window.clearTimeout(state.voiceReconnectTimer);
    state.voiceReconnectTimer = null;
  }
  state.voiceReconnecting = false;
}

function clearVoiceFinalizeTimer() {
  if (state.voiceFinalizeTimer) {
    window.clearTimeout(state.voiceFinalizeTimer);
    state.voiceFinalizeTimer = null;
  }
}

function flushPendingStreamFrames() {
  const socket = state.voiceSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const frame of pendingStreamBuffer.drain()) {
    socket.send(frame);
  }
}

function sendOrBufferStreamFrame(pcmBuffer) {
  if (state.voiceOutgoingReady && state.voiceSocket?.readyState === WebSocket.OPEN) {
    flushPendingStreamFrames();
    state.voiceSocket.send(pcmBuffer);
    return;
  }
  if (state.mode === 'recording') {
    pendingStreamBuffer.push(pcmBuffer);
  }
}

function pushPreRollFrame(pcmBuffer) {
  if (state.mode === 'recording' || state.mode === 'off') return;
  preRollBuffer.push(pcmBuffer);
}

function handleWakeAudioFrame(pcmBuffer) {
  pushPreRollFrame(pcmBuffer);
  if (state.wakeUsesVosk && desktop.sendVoskFrame) {
    desktop.sendVoskFrame(pcmBuffer);
  }
}

function reconnectDelayLabel(delayMs) {
  return delayMs < 1000 ? `${delayMs}ms` : `${Math.round(delayMs / 1000)}s`;
}

function scheduleVoiceReconnect() {
  if (state.mode !== 'recording' || state.voiceStreamEnding || !state.voiceSessionId) return;
  if (state.voiceReconnecting) return;
  state.voiceReconnecting = true;
  const attempt = Math.min(state.voiceReconnectAttempt, MAX_RECONNECT_EXPONENT);
  state.voiceReconnectAttempt += 1;
  const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (2 ** attempt));
  showStatus(`Reconnecting voice stream in ${reconnectDelayLabel(delayMs)}.`);
  state.voiceReconnectTimer = window.setTimeout(() => {
    state.voiceReconnectTimer = null;
    state.voiceReconnecting = false;
    if (state.mode !== 'recording' || state.voiceStreamEnding) return;
    state.voiceOutgoingReady = false;
    const previousSocket = state.voiceSocket;
    if (previousSocket) {
      previousSocket.onclose = null;
      previousSocket.onerror = null;
      previousSocket.onmessage = null;
      try {
        previousSocket.close();
      } catch {
        // Ignore stale socket cleanup errors during reconnect.
      }
    }
    state.voiceSocket = openVoiceSocket(state.voiceTarget);
  }, delayMs);
}

function resetVoiceStreamState() {
  clearVoiceReconnectTimer();
  clearVoiceFinalizeTimer();
  state.voiceOutgoingReady = false;
  state.voiceReconnectAttempt = 0;
  state.voiceStreamEnding = false;
  state.voicePostStopMode = 'awake';
  state.voicePostStopStatus = '';
  pendingStreamBuffer.clear();
}

async function cleanupLocalCapture() {
  if (state.processor) {
    state.processor.disconnect();
  }
  if (state.audioContext) {
    await state.audioContext.close().catch(() => {});
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  state.audioContext = null;
  state.processor = null;
  cancelAnimationFrame(state.meterFrame);
  els.meterBar.style.width = '0%';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

async function loadDashboard() {
  updateConnection('pending', 'Connecting', 'Loading dashboard');
  try {
    if (state.config?.deviceId && state.config?.deviceToken) {
      const data = await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/bootstrap`, {
        headers: {
          'x-voice-device-token': state.config.deviceToken,
          'x-voice-installation-id': state.config.installationId || '',
          'x-voice-client-version': '1',
        },
      });
      state.dashboard = { devices: [data.device] };
      state.voiceSettings = data.settings;
      if (state.voiceSettings) {
        state.approvalRecognizer.configure({
          triggerPhrase: state.voiceSettings.triggerPhrase,
          minDigits: state.voiceSettings.minDigits,
          maxDigits: state.voiceSettings.maxDigits,
          stableMs: state.voiceSettings.stableMs,
          collectTimeoutMs: state.voiceSettings.collectTimeoutMs,
          duplicateCooldownMs: state.voiceSettings.duplicateCooldownMs,
          finalizeCheckIntervalMs: state.voiceSettings.finalizeCheckIntervalMs,
        });
      }
      updateConnection('ok', 'Connected', `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}`);
      if (els.accountLabel) els.accountLabel.textContent = data.device.displayName || state.config.deviceName || 'Connected';
      if (els.accountDetail) els.accountDetail.textContent = `Device ${state.config.deviceId.slice(0, 12)}`;
      showPairingMessage('Desktop connected.');
      return data;
    }
    const dashboard = await api('/api/dashboard');
    state.dashboard = dashboard;
    state.voiceSettings = dashboard.settings;
    if (state.voiceSettings) {
      state.approvalRecognizer.configure({
        triggerPhrase: state.voiceSettings.triggerPhrase,
        minDigits: state.voiceSettings.minDigits,
        maxDigits: state.voiceSettings.maxDigits,
        stableMs: state.voiceSettings.stableMs,
        collectTimeoutMs: state.voiceSettings.collectTimeoutMs,
        duplicateCooldownMs: state.voiceSettings.duplicateCooldownMs,
        finalizeCheckIntervalMs: state.voiceSettings.finalizeCheckIntervalMs,
      });
    }
    updateConnection('ok', 'Connected', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : `${dashboard.user.displayName}`);
    showPairingMessage(state.config.deviceId ? 'Desktop connected.' : `Signed in as ${dashboard.user.displayName}. Connect this desktop before recording.`);
  } catch (err) {
    updateConnection('error', 'Connection failed', err?.message || 'Could not reach server');
    if (err?.authFailure) {
      showStatus(err.message);
    }
    throw err;
  }
}

async function applyPairingPayload(rawPayload) {
  const payload = String(rawPayload || '').trim();
  if (!payload) {
    showPairingMessage('Paste a pairing payload or ws:// server URL first.', 'error');
    return;
  }
  if (isUpdatePayload(payload)) {
    handleUpdatePayload(parseUpdatePayload(payload));
    return;
  }

  let config;
  try {
    config = parsePairingPayload(payload);
  } catch (err) {
    showPairingMessage(`Pairing failed: ${err.message}`, 'error');
    return;
  }

  if (!clientVersionSupported(config.minClientVersion)) {
    showPairingMessage(`This server requires desktop client version ${config.minClientVersion} or newer.`, 'error');
    return;
  }
  if (pairingPayloadExpired(config.expiresAt)) {
    showPairingMessage(`Pairing payload expired at ${config.expiresAt}. Generate a new payload from the dashboard.`, 'error');
    return;
  }

  const current = readFormConfig();
  const nextConfig = {
    ...current,
    serverUrl: config.serverUrl,
    deviceName: config.deviceName || current.deviceName,
  };

  if (!config.deviceId) {
    applyConfig(await desktop.writeConfig(nextConfig));
    showPairingMessage('Server URL saved from pairing payload. Pair this desktop or paste a full payload with device credentials.');
    showStatus('Server URL saved from pairing payload.');
    await loadDashboard().catch((err) => showStatus(err.message));
    return;
  }

  const paired = await desktop.writeConfig({
    ...nextConfig,
    deviceId: config.deviceId,
    deviceToken: config.token,
  });
  applyConfig(paired);
  ensureControlSocket();
  showPairingMessage(`Paired ${config.deviceId.slice(0, 14)} from pairing payload.`);
  showStatus(`Paired ${config.deviceId.slice(0, 14)} from pairing payload.`);
  await loadDashboard().catch((err) => showStatus(err.message));
}

function handleUpdatePayload(update) {
  showPairingMessage(`Update QR targets Android build ${update.versionCode}. Desktop updates are installed separately from the dashboard APK flow.`);
  if (update.apkUrl) {
    void desktop.openExternal(update.apkUrl);
  }
}

async function loadVoiceSettings() {
  if (state.voiceSettings) return state.voiceSettings;
  const data = await api('/api/settings/voice-approval');
  state.voiceSettings = data.settings;
  state.approvalRecognizer.configure({
    triggerPhrase: data.settings.triggerPhrase,
    minDigits: data.settings.minDigits,
    maxDigits: data.settings.maxDigits,
    stableMs: data.settings.stableMs,
    collectTimeoutMs: data.settings.collectTimeoutMs,
    duplicateCooldownMs: data.settings.duplicateCooldownMs,
    finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
  });
  return state.voiceSettings;
}

async function pairDevice() {
  const config = readFormConfig();
  const data = await api('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceType: 'desktop', displayName: config.deviceName, installationId: config.installationId }),
  });
  applyConfig(await desktop.writeConfig({ ...config, deviceId: data.device.id, deviceToken: data.token }));
  ensureControlSocket();
  showPairingMessage('Desktop connected.');
  showStatus('Desktop connected.');
  await loadDashboard();
}

async function signInWithBrowser() {
  clearDesktopAuthPoll();
  const saved = await desktop.writeConfig(authSessionFields(readFormConfig()));
  applyConfig(saved);
  const authBaseUrl = deriveWebUrl(saved) || saved.serverUrl;
  if (!authBaseUrl) {
    updateAuthStatus('error', 'Configure a server URL before signing in.');
    return;
  }
  const data = await api('/api/desktop-auth/requests', {
    method: 'POST',
    body: JSON.stringify({ displayName: saved.deviceName, protocolVersion: 1, installationId: saved.installationId }),
  });
  const authUrl = new URL(authBaseUrl);
  authUrl.searchParams.set('desktopAuthRequest', data.requestId);
  authUrl.searchParams.set('desktopAuthSecret', data.secret);
  authUrl.searchParams.set('desktopName', saved.deviceName);
  void desktop.openExternal(authUrl.toString());
  startDesktopAuthPoll({
    requestId: data.requestId,
    secret: data.secret,
    deviceToken: data.deviceToken,
    expiresAt: data.expiresAt,
  });
  updateAuthStatus('idle', 'Opened browser sign in. This desktop will connect automatically after login.');
}

function clearDesktopAuthPoll() {
  if (state.desktopAuthPollTimer) {
    window.clearTimeout(state.desktopAuthPollTimer);
    state.desktopAuthPollTimer = null;
  }
}

function startDesktopAuthPoll(auth) {
  let inFlight = false;
  const expiresAt = Date.parse(auth.expiresAt || '') || (Date.now() + 10 * 60 * 1000);
  const poll = async () => {
    if (inFlight) return;
    if (Date.now() > expiresAt + 5000) {
      clearDesktopAuthPoll();
      updateAuthStatus('error', 'Desktop sign in expired. Try Sign in again.');
      return;
    }
    inFlight = true;
    try {
      const data = await api('/api/desktop-auth/result', {
        method: 'POST',
        body: JSON.stringify({ requestId: auth.requestId, secret: auth.secret }),
      });
      if (data.status === 'claimed' && data.device?.id) {
        clearDesktopAuthPoll();
        const current = readFormConfig();
        const paired = await desktop.writeConfig({
          ...current,
          deviceId: data.device.id,
          deviceToken: auth.deviceToken,
          deviceName: data.device.displayName || current.deviceName,
        });
        applyConfig(paired);
        void desktop.expandWindow?.().then(applyWindowState);
        ensureControlSocket();
        updateAuthStatus('ok', 'Desktop connected through browser sign in.');
        showPairingMessage('Desktop connected through browser sign in.');
        showStatus('Desktop connected.');
        await loadDashboard().catch((err) => showStatus(err.message));
        return;
      }
      updateAuthStatus('idle', 'Waiting for browser sign in to finish.');
    } catch (err) {
      clearDesktopAuthPoll();
      updateAuthStatus('error', err?.message || 'Desktop sign in failed.');
      return;
    } finally {
      inFlight = false;
    }
    state.desktopAuthPollTimer = window.setTimeout(poll, 1000);
  };
  state.desktopAuthPollTimer = window.setTimeout(poll, 1000);
}

function configuredDeviceIsKnown() {
  if (!state.config?.deviceId || !state.dashboard?.devices) return true;
  return state.dashboard.devices.some((device) => device.id === state.config.deviceId);
}

async function clearSavedDevice(reason) {
  clearDesktopAuthPoll();
  const config = readFormConfig();
  const nextConfig = await desktop.writeConfig({ ...config, deviceId: '', deviceToken: '' });
  applyConfig(nextConfig);
  void desktop.expandWindow?.().then(applyWindowState);
  stopWakeListener();
  setMode('off', 'Sign in to start voice.');
  if (reason) showPairingMessage(reason, 'error');
}

function staleDeviceError(err) {
  const message = String(err?.message || '');
  return err?.statusCode === 404 ||
    err?.statusCode === 401 ||
    /unknown device|not found|foreign key/i.test(message);
}

function isMediaDeviceNotFound(err) {
  const message = String(err?.message || '');
  return err?.name === 'NotFoundError' ||
    err?.name === 'DevicesNotFoundError' ||
    /requested device not found|device not found|no audio input/i.test(message);
}

function audioDeviceLabel(device, fallback) {
  return String(device.label || fallback).trim();
}

function pickerElementsForSelect(select) {
  if (select === els.inputDeviceSelect) {
    return { button: els.inputDeviceButton, label: els.inputDeviceLabel, menu: els.inputDeviceMenu };
  }
  if (select === els.outputDeviceSelect) {
    return { button: els.outputDeviceButton, label: els.outputDeviceLabel, menu: els.outputDeviceMenu };
  }
  return { button: null, label: null, menu: null };
}

function closeDeviceMenus(exceptMenu = null) {
  [els.inputDeviceMenu, els.outputDeviceMenu].forEach((menu) => {
    if (!menu || menu === exceptMenu) return;
    menu.hidden = true;
  });
  [els.inputDeviceButton, els.outputDeviceButton].forEach((button) => {
    if (!button) return;
    const picker = pickerElementsForSelect(button === els.inputDeviceButton ? els.inputDeviceSelect : els.outputDeviceSelect);
    button.setAttribute('aria-expanded', String(Boolean(picker.menu && !picker.menu.hidden)));
  });
}

function closeSettingsPanel() {
  if (!els.settingsPanel || !els.settingsButton) return;
  els.settingsPanel.hidden = true;
  els.settingsButton.setAttribute('aria-expanded', 'false');
  closeDeviceMenus();
}

function toggleSettingsPanel() {
  if (!els.settingsPanel || !els.settingsButton) return;
  const willOpen = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !willOpen;
  els.settingsButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    void refreshAudioDevicePickers();
  } else {
    closeDeviceMenus();
  }
}

function renderDevicePicker(select) {
  if (!select) return;
  const { button, label, menu } = pickerElementsForSelect(select);
  if (!button || !label || !menu) return;
  const selectedOption = select.selectedOptions[0] || select.options[0];
  label.textContent = selectedOption?.textContent || 'System default';
  menu.textContent = '';

  [...select.options].forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'device-picker-option';
    item.role = 'option';
    item.textContent = option.textContent || 'Audio device';
    item.dataset.value = option.value;
    item.setAttribute('aria-selected', String(option.value === select.value));
    item.addEventListener('click', () => {
      select.value = option.value;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    menu.append(item);
  });
}

function toggleDevicePicker(select) {
  const { button, menu } = pickerElementsForSelect(select);
  if (!button || !menu) return;
  const willOpen = menu.hidden;
  closeDeviceMenus(menu);
  menu.hidden = !willOpen;
  button.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.device-picker-option');
    selected?.focus();
  }
}

function setSelectOptions(select, devices, selectedDeviceId, defaultLabel, fallbackPrefix) {
  if (!select) return;
  const current = selectedDeviceId || '';
  select.textContent = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  select.append(defaultOption);

  devices.forEach((device, index) => {
    if (!device.deviceId || device.deviceId === 'default' || device.deviceId === 'communications') return;
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = audioDeviceLabel(device, `${fallbackPrefix} ${index + 1}`);
    select.append(option);
  });

  const hasSelected = current && [...select.options].some((option) => option.value === current);
  if (hasSelected) {
    select.value = current;
  } else if (current) {
    const missingOption = document.createElement('option');
    missingOption.value = current;
    missingOption.textContent = 'Selected device unavailable';
    select.append(missingOption);
    select.value = current;
  } else {
    select.value = '';
  }
  renderDevicePicker(select);
}

async function refreshAudioDevicePickers() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setSelectOptions(
      els.inputDeviceSelect,
      devices.filter((device) => device.kind === 'audioinput'),
      state.config?.inputDeviceId,
      'System default',
      'Microphone',
    );
    setSelectOptions(
      els.outputDeviceSelect,
      devices.filter((device) => device.kind === 'audiooutput'),
      state.config?.outputDeviceId,
      'System default',
      'Speaker',
    );
  } catch (err) {
    showStatus(err?.message ? `Audio devices unavailable: ${err.message}` : 'Audio devices unavailable.');
  }
}

async function saveAudioDeviceSelection() {
  const next = await desktop.writeConfig(authSessionFields(readFormConfig()));
  applyConfig(next);
  await refreshAudioDevicePickers();
}

async function restartWakeListenerForDeviceChange() {
  if (state.stream) return;
  const shouldRestart = state.mode !== 'off' && (state.wakeStream || state.recognition || state.wakeStarting);
  if (!shouldRestart) return;
  stopWakeListener();
  startWakeListener();
}

async function getMicrophoneStream() {
  const selectedDeviceId = state.config?.inputDeviceId || '';
  if (selectedDeviceId) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: selectedDeviceId } },
      });
      void refreshAudioDevicePickers();
      return stream;
    } catch (err) {
      if (!isMediaDeviceNotFound(err)) throw err;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    void refreshAudioDevicePickers();
    return stream;
  } catch (initialError) {
    if (!isMediaDeviceNotFound(initialError) || !navigator.mediaDevices?.enumerateDevices) {
      throw initialError;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
    if (!audioInputs.length) {
      const err = new Error('No microphone input was found. Check your system sound input settings.');
      err.cause = initialError;
      throw err;
    }

    let lastError = initialError;
    for (const device of audioInputs) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: device.deviceId } },
        });
        void refreshAudioDevicePickers();
        return stream;
      } catch (err) {
        lastError = err;
      }
    }

    const err = new Error('No available microphone input could be opened.');
    err.cause = lastError;
    throw err;
  }
}

async function ensureRecordingDevice() {
  if (!state.config?.deviceId || !state.config?.deviceToken) {
    throw new Error('Sign in before starting voice.');
  }
  if (!configuredDeviceIsKnown()) {
    await clearSavedDevice('Saved desktop connection was not found on this server. Sign in again.');
    throw new Error('Sign in before starting voice.');
  }
}

async function createVoiceSession(target) {
  await ensureRecordingDevice();
  try {
    return await api('/api/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId: state.config.deviceId, token: state.config.deviceToken, mode: target, protocolVersion: 1 }),
    });
  } catch (err) {
    if (!staleDeviceError(err)) throw err;
    await clearSavedDevice('Saved desktop pairing is stale. Re-pairing desktop.');
    await pairDevice();
    return api('/api/voice/sessions', {
      method: 'POST',
      body: JSON.stringify({ deviceId: state.config.deviceId, token: state.config.deviceToken, mode: target, protocolVersion: 1 }),
    });
  }
}

async function startMic(target = 'assistant', options = {}) {
  const session = await createVoiceSession(target);
  stopWakeListener();
  try {
    state.voiceSessionId = session.session.id;
    state.voiceTarget = cleanVoiceTarget(target);
    resetVoiceStreamState();
    pendingStreamBuffer.pushAll(preRollBuffer.drain());
    if (options.cue) playLocalVoiceCue(options.cue);
    state.stream = await getMicrophoneStream();
    const context = new AudioContext({ sampleRate: 16000 });
    state.audioContext = context;
    const source = context.createMediaStreamSource(state.stream);
    state.analyser = context.createAnalyser();
    state.analyser.fftSize = 256;
    state.processor = context.createScriptProcessor(4096, 1, 1);
    state.voiceSocket = openVoiceSocket(state.voiceTarget);
    state.processor.onaudioprocess = (event) => {
      sendOrBufferStreamFrame(floatToPcm16(event.inputBuffer.getChannelData(0)));
    };
    source.connect(state.analyser);
    source.connect(state.processor);
    state.processor.connect(context.destination);
    setMode('recording', recordingStatus(state.voiceTarget));
    await api('/api/logs', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: state.config.deviceId,
        token: state.config.deviceToken,
        source: 'desktop',
        level: 'info',
        message: 'Desktop microphone capture started',
        protocolVersion: 1,
      }),
    });
    renderMeter();
  } catch (err) {
    if (state.processor) state.processor.disconnect();
    if (state.audioContext) await state.audioContext.close().catch(() => {});
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.audioContext = null;
    state.processor = null;
    state.voiceSocket = null;
    state.voiceSessionId = null;
    resetVoiceStreamState();
    if (state.mode !== 'off') startWakeListener();
    throw err;
  }
}

async function stopMic(nextMode = 'awake', options = {}) {
  state.voiceStreamEnding = true;
  clearVoiceReconnectTimer();
  const localSocket = state.voiceSocket;
  if (localSocket) {
    const sendEnd = () => {
      try {
        localSocket.send(JSON.stringify({ type: 'end' }));
      } catch {
        // The socket may have closed between the readyState check and send.
      }
    };
    if (localSocket.readyState === WebSocket.OPEN) {
      sendEnd();
    } else if (localSocket.readyState === WebSocket.CONNECTING) {
      localSocket.addEventListener('open', sendEnd, { once: true });
    }
  }
  await cleanupLocalCapture();
  state.voiceOutgoingReady = false;
  pendingStreamBuffer.clear();
  if (options.cue !== null) {
    playLocalVoiceCue(options.cue ?? 'stop_button');
  }
  if (!localSocket || localSocket.readyState === WebSocket.CLOSED || localSocket.readyState === WebSocket.CLOSING) {
    completeStoppedVoice(nextMode, options.finalStatus || 'Capture stopped.');
  } else {
    state.voicePostStopMode = nextMode;
    state.voicePostStopStatus = options.finalStatus || '';
    setMode('transcribing', nextMode === 'off' ? 'Finishing voice transcription, then turning off.' : 'Finishing voice transcription.');
    state.voiceFinalizeTimer = window.setTimeout(() => {
      void logDesktopEvent('warn', 'Voice stream finalization timed out', { nextMode, target: state.voiceTarget });
      completeStoppedVoice(nextMode, options.finalStatus || 'Voice transcription timed out.');
    }, 30_000);
  }
  await api('/api/logs', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: state.config.deviceId,
      token: state.config.deviceToken,
      source: 'desktop',
      level: 'info',
      message: 'Desktop microphone capture stopped',
      protocolVersion: 1,
    }),
  });
  await loadDashboard().catch(() => {});
}

function openVoiceSocket(target) {
  const config = readFormConfig();
  const url = new URL('/api/voice/stream', trimSlash(config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', state.config.deviceId);
  url.searchParams.set('token', state.config.deviceToken);
  if (state.voiceSessionId) url.searchParams.set('sessionId', state.voiceSessionId);
  url.searchParams.set('mode', target);
  const socket = new WebSocket(url.toString());
  let terminalMessageReceived = false;
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    state.voiceReconnectAttempt = 0;
    state.voiceOutgoingReady = true;
    socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-fallback', mode: target }));
    flushPendingStreamFrames();
    showStatus(recordingStatus(target));
  };
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') {
      playWav(event.data);
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      }
      if (message.type === 'assistant_result') {
        terminalMessageReceived = true;
        showStatus(`Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`);
        state.voicePostStopStatus = els.micStatus.textContent || state.voicePostStopStatus;
        state.voicePostStopMode = 'awake';
        await finishMicFromServer();
      }
      if (message.type === 'transcript_result') {
        terminalMessageReceived = true;
        showStatus(message.status || 'Transcript patched into chat.');
        state.voicePostStopStatus = els.micStatus.textContent || state.voicePostStopStatus;
        state.voicePostStopMode = 'awake';
        await finishMicFromServer();
      }
      if (message.type === 'terminal_detected') {
        await handleTerminalDetected(message, socket, target);
      }
      if (message.type === 'sleep') {
        terminalMessageReceived = true;
        if (target === 'clipboard') {
          const transcriptText = message.transcriptText || '';
          const copied = await copyText(transcriptText);
          void logDesktopEvent(copied ? 'info' : 'warn', copied ? 'Clipboard transcription copied' : 'Clipboard transcription copy failed', {
            chars: String(transcriptText || '').trim().length,
          });
          showStatus(copied ? 'Copied voice transcription.' : 'No voice transcription detected.');
        } else {
          showStatus('Awake. Waiting for voice command.');
        }
        state.voicePostStopStatus = els.micStatus.textContent || state.voicePostStopStatus;
        state.voicePostStopMode = 'awake';
        await finishMicFromServer();
      }
      if (message.type === 'assistant_error') {
        terminalMessageReceived = true;
        showStatus(message.error || 'Voice runtime failed.');
        state.voicePostStopStatus = els.micStatus.textContent || state.voicePostStopStatus;
        state.voicePostStopMode = 'awake';
        await finishMicFromServer();
      }
    } catch {
      // Ignore non-protocol text frames in the fallback desktop shell.
    }
  };
  socket.onclose = (event) => {
    state.voiceOutgoingReady = false;
    if (state.voiceStreamEnding && state.voiceSocket === socket) {
      if (target === 'clipboard' && !terminalMessageReceived) {
        void logDesktopEvent('warn', 'Voice stream closed before clipboard result', { code: event.code, reason: event.reason || '' });
      }
      completeStoppedVoice(state.voicePostStopMode || 'awake', state.voicePostStopStatus || 'Voice stream closed before transcription completed.');
      return;
    }
    if (state.mode === 'recording' && !state.voiceStreamEnding && event.code === 1000) {
      if (target === 'clipboard' && !terminalMessageReceived) {
        void logDesktopEvent('warn', 'Voice stream closed before clipboard result', { code: event.code, reason: event.reason || '' });
      }
      void finishMicFromServer();
      return;
    }
    if (state.mode === 'recording' && !state.voiceStreamEnding) {
      showStatus('Voice stream disconnected.');
      scheduleVoiceReconnect();
      return;
    }
    if (!state.voiceStreamEnding) {
      showStatus('Voice stream closed.');
    }
  };
  socket.onerror = () => {
    state.voiceOutgoingReady = false;
    if (state.mode === 'recording' && !state.voiceStreamEnding) {
      showStatus('Voice stream error.');
      scheduleVoiceReconnect();
    }
  };
  return socket;
}

async function handleTerminalDetected(message, socket, target) {
  if (state.voiceSocket !== socket || state.voiceStreamEnding) return;
  state.voiceStreamEnding = true;
  clearVoiceReconnectTimer();
  await cleanupLocalCapture();
  state.voiceOutgoingReady = false;
  pendingStreamBuffer.clear();
  playLocalVoiceCue('stop_button');
  const commandType = String(message.commandType || '');
  const status = commandType === 'abort'
    ? 'Awake. Voice command cancelled.'
    : target === 'clipboard'
      ? 'Awake. Finishing clipboard transcription.'
      : 'Awake. Finishing voice request.';
  state.voicePostStopMode = 'awake';
  state.voicePostStopStatus = status;
  setMode('awake', status);
  void logDesktopEvent('info', 'Desktop microphone capture stopped after terminal phrase', {
    commandType,
    phrase: message.phrase || '',
    detectedAt: message.detectedAt || '',
    partialTranscriptChars: Number(message.partialTranscriptChars || 0),
    target,
  });
}

async function finishMicFromServer() {
  state.voiceStreamEnding = true;
  clearVoiceReconnectTimer();
  await cleanupLocalCapture();
  const nextMode = state.voicePostStopMode || 'awake';
  const nextStatus = state.voicePostStopStatus || els.micStatus.textContent || 'Awake. Waiting for voice command.';
  completeStoppedVoice(nextMode, nextStatus);
  await loadDashboard().catch(() => {});
}

function completeStoppedVoice(nextMode = 'awake', status = '') {
  clearVoiceFinalizeTimer();
  const socket = state.voiceSocket;
  state.voiceSocket = null;
  state.voiceSessionId = null;
  resetVoiceStreamState();
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.close(1000, 'client finalized');
    } catch {
      // Ignore close races after the server has already finalized the stream.
    }
  }
  if (nextMode === 'off') {
    stopWakeListener();
    resetApprovalCollection();
    preRollBuffer.clear();
    setMode('off', 'Off.');
    return;
  }
  if (nextMode === 'sleeping') {
    setMode('sleeping', status || 'Sleeping.');
    startWakeListener();
    return;
  }
  setMode('awake', status || 'Awake. Waiting for voice command.');
  startWakeListener();
}

function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function cleanVoiceTarget(target) {
  return target === 'patch' || target === 'clipboard' ? target : 'assistant';
}

function recordingStatus(target) {
  if (target === 'patch') return 'Patching voice transcript into chat.';
  if (target === 'clipboard') return 'Recording clipboard transcription.';
  return 'Streaming microphone frames to the VoiceStream service.';
}

async function copyText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (desktop.writeClipboard) {
    try {
      await desktop.writeClipboard(trimmed);
      return true;
    } catch {
      // Fall through to the browser clipboard API when the desktop bridge is unavailable.
    }
  }
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch {
    return false;
  }
}

const speechPlaybackQueue = [];
let speechPlaybackActive = false;

function playWav(data) {
  speechPlaybackQueue.push(data);
  void drainSpeechPlaybackQueue();
}

function playWavBase64(audioBase64) {
  const clean = String(audioBase64 || '').trim();
  if (!clean) return;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  playWav(bytes.buffer);
}

async function drainSpeechPlaybackQueue() {
  if (speechPlaybackActive) return;
  speechPlaybackActive = true;
  try {
    while (speechPlaybackQueue.length > 0) {
      await playWavNow(speechPlaybackQueue.shift());
    }
  } finally {
    speechPlaybackActive = false;
  }
}

async function playWavNow(data) {
  const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }));
  const audio = new Audio(url);
  const outputDeviceId = state.config?.outputDeviceId || '';
  try {
    if (outputDeviceId && typeof audio.setSinkId === 'function') {
      await audio.setSinkId(outputDeviceId);
    }
    await new Promise((resolve) => {
      const finish = () => resolve();
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      audio.play().catch(finish);
    });
  } catch (err) {
    showStatus(err?.message ? `Audio playback failed: ${err.message}` : 'Audio playback failed.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function resetApprovalCollection() {
  if (state.approvalFinalizeTimer) {
    window.clearTimeout(state.approvalFinalizeTimer);
    state.approvalFinalizeTimer = null;
  }
  state.approvalRecognizer.reset();
}

function scheduleApprovalFinalize() {
  if (state.approvalFinalizeTimer) window.clearTimeout(state.approvalFinalizeTimer);
  state.approvalFinalizeTimer = window.setTimeout(() => {
    state.approvalFinalizeTimer = null;
    handleApprovalUpdate(state.approvalRecognizer.flush(Date.now()));
    if (state.approvalRecognizer.isCollecting && state.mode !== 'off') {
      scheduleApprovalFinalize();
    }
  }, state.approvalRecognizer.finalizeCheckIntervalMs());
}

function showCollectingStatus(partialCode) {
  const nextStatus = partialCode
    ? (state.mode === 'sleeping' ? `Unlock: ${partialCode}` : `Approval: ${partialCode}`)
    : (state.mode === 'sleeping' ? 'Unlock code...' : 'Approval code...');
  showStatus(nextStatus);
}

function handleApprovalUpdate(update) {
  if (update.type === 'none') return false;
  if (update.type === 'collecting') {
    showCollectingStatus(update.partialCode);
    return true;
  }
  if (update.type === 'cancelled') {
    showStatus('Approval cancelled.');
    return true;
  }
  void processApprovalCode(update.code);
  return true;
}

function acceptApprovalText(text, finalizeNow = false) {
  const now = Date.now();
  let update = state.approvalRecognizer.accept(text, now);
  if (state.approvalRecognizer.isCollecting) {
    if (finalizeNow) {
      update = state.approvalRecognizer.flush(now + (state.voiceSettings?.stableMs ?? 900));
    } else {
      scheduleApprovalFinalize();
    }
  }
  if (update.type === 'none') {
    return state.approvalRecognizer.isCollecting;
  }
  return handleApprovalUpdate(update);
}

function wakePhraseMatch(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return 'sleep';
  if (words.some((word, index) => (word === 'hey' || word === 'hay') && (words[index + 1] === 'sebastian' || words[index + 1] === 'sebastien'))) return 'start';
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return 'patch';
  if (words.some((word, index) => word === 'can' && words[index + 1] === 'you' && words[index + 2] === 'transcribe')) return 'clipboard';
  if (words.includes('status') || compact === 'stateus' || compact === 'checkstatus') return 'status';
  return null;
}

async function logDesktopEvent(level, message, details) {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  await api('/api/logs', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: state.config.deviceId,
      token: state.config.deviceToken,
      source: 'desktop',
      level,
      message,
      details,
      protocolVersion: 1,
    }),
  }).catch(() => {});
}

async function enterAwake() {
  resetApprovalCollection();
  await loadVoiceSettings().catch(() => null);
  setMode('awake', 'Awake. Say "hey Sebastian" to start recording.');
  startWakeListener();
}

async function enterSleep() {
  if (state.voiceSocket || state.stream) {
    await stopMic('sleeping', { cue: null, finalStatus: 'Sleeping.' });
    return;
  }
  resetApprovalCollection();
  playLocalVoiceCue('sleep');
  const settings = await loadVoiceSettings().catch(() => null);
  setMode('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
  startWakeListener();
}

async function turnOff(options = {}) {
  if (state.voiceSocket || state.stream) {
    await stopMic('off', { cue: options.cue || 'stop_button' });
    return;
  }
  stopWakeListener();
  resetApprovalCollection();
  preRollBuffer.clear();
  playLocalVoiceCue(options.cue || 'stop_button');
  setMode('off', 'Off.');
}

async function processApprovalCode(code) {
  const settings = await loadVoiceSettings();
  if (state.mode === 'sleeping' && code === settings.unlockCode) {
    playLocalVoiceCue('unlock');
    setMode('awake', 'Unlocked.');
    return;
  }
  if (code === settings.lockedOffCode) {
    await turnOff({ cue: 'sleeping_off' });
    return;
  }
  if (state.mode !== 'sleeping' && code === settings.lockCode) {
    await enterSleep();
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus(`Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.`);
    return;
  }
  playLocalVoiceCue('status');
  await api('/api/voice/approval-codes', { method: 'POST', body: JSON.stringify({ code, source: 'desktop' }) });
  showStatus(`Approval sent: ${code}.`);
  await loadDashboard();
}

async function processPhraseText(text, finalizeNow = false) {
  if (acceptApprovalText(text, finalizeNow)) return;
  if (state.mode === 'recording') {
    showStatus('Recording. Wake commands are ignored until capture stops.');
    void logDesktopEvent('info', 'Wake phrase ignored while recording', { text });
    return;
  }
  const match = wakePhraseMatch(text);
  if (!match) {
    const heard = String(text || '').trim();
    showStatus(heard ? `Heard "${heard}". No voice command matched.` : 'No voice command matched.');
    void logDesktopEvent('info', 'Wake phrase did not match command', { text: heard });
    return;
  }
  void logDesktopEvent('info', 'Wake command matched', { text, command: match });
  if (match === 'sleep') {
    await enterSleep();
    return;
  }
  if (match === 'status') {
    playLocalVoiceCue('status');
    showStatus(`Mode: ${state.mode}. Device: ${state.config?.deviceId ? state.config.deviceId.slice(0, 12) : 'unpaired'}.`);
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus('Sleeping. Press Wake or say the unlock code.');
    return;
  }
  if (state.mode === 'off') enterAwake();
  await startMic(match === 'patch' || match === 'clipboard' ? match : 'assistant', { cue: 'wake' });
}

async function startWakeAudioCapture() {
  const media = await getMicrophoneStream();
  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(media);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    handleWakeAudioFrame(floatToPcm16(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);
  state.wakeStream = media;
  state.wakeAudioContext = context;
  state.wakeProcessor = processor;
  return true;
}

function startWakeListener() {
  if (state.wakeStarting || state.wakeStream || state.recognition) {
    showStatus('Awake. Listening for voice commands.');
    return;
  }
  if (desktop.startVosk && desktop.sendVoskFrame && desktop.onVoskText) {
    startVoskWakeListener().then((started) => {
      if (!started) startSpeechWakeListener();
    });
    return;
  }
  startSpeechWakeListener();
}

async function startVoskWakeListener() {
  state.wakeStarting = true;
  try {
    const status = await desktop.startVosk();
    if (!status.available) {
      showStatus(status.error ? `Vosk unavailable: ${status.error}` : 'Wake listener unavailable.');
      return false;
    }

    state.wakeUsesVosk = true;
    const unsubscribe = desktop.onVoskText((result) => {
      const text = String(result?.text || '').trim();
      if (!text) return;
      const now = Date.now();
      if (text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
      state.lastRecognizedText = text;
      state.lastRecognizedAt = now;
      void processPhraseText(text).catch((err) => showStatus(err.message));
    });

    await startWakeAudioCapture();
    state.wakeUnsubscribe = unsubscribe;
    showStatus('Awake. Listening with Vosk.');
    return true;
  } catch (err) {
    stopVoskWakeListener();
    showStatus(err?.message ? `Vosk listener failed: ${err.message}` : 'Vosk listener failed.');
    return false;
  } finally {
    state.wakeStarting = false;
  }
}

function startSpeechWakeListener() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showStatus('Awake. Wake phrase recognition is unavailable in this runtime.');
    return;
  }
  if (state.recognition) {
    showStatus('Awake. Listening for voice commands.');
    return;
  }
  state.wakeUsesVosk = false;
  void startWakeAudioCapture().catch((err) => showStatus(err?.message || 'Wake audio capture failed.'));
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = result?.[0]?.transcript?.trim();
    if (!text) return;
    const now = Date.now();
    if (text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
    state.lastRecognizedText = text;
    state.lastRecognizedAt = now;
    void processPhraseText(text).catch((err) => showStatus(err.message));
  };
  recognition.onerror = () => showStatus('Wake listener paused.');
  recognition.onend = () => {
    state.recognition = null;
    if (state.mode !== 'off' && !state.stream) {
      window.setTimeout(() => startWakeListener(), 350);
    }
  };
  state.recognition = recognition;
  try {
    recognition.start();
    showStatus('Awake. Listening for voice commands.');
  } catch {
    state.recognition = null;
    showStatus('Awake. Wake phrase recognition is unavailable in this runtime.');
  }
}

function stopWakeListener() {
  stopVoskWakeListener();
  const recognition = state.recognition;
  if (!recognition) return;
  recognition.onend = null;
  state.recognition = null;
  try {
    recognition.stop();
  } catch {
    // Ignore already-ended SpeechRecognition sessions.
  }
}

function stopVoskWakeListener() {
  if (state.wakeUnsubscribe) state.wakeUnsubscribe();
  state.wakeUnsubscribe = null;
  state.wakeUsesVosk = false;
  if (state.wakeProcessor) state.wakeProcessor.disconnect();
  state.wakeProcessor = null;
  if (state.wakeStream) state.wakeStream.getTracks().forEach((track) => track.stop());
  state.wakeStream = null;
  if (state.wakeAudioContext) void state.wakeAudioContext.close().catch(() => {});
  state.wakeAudioContext = null;
  state.wakeStarting = false;
  if (desktop.stopVosk) void desktop.stopVosk();
}

function renderMeter() {
  if (!state.analyser || !state.stream) return;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  els.meterBar.style.width = `${Math.min(100, Math.round(average))}%`;
  state.meterFrame = requestAnimationFrame(renderMeter);
}

async function togglePrimaryVoice() {
  if (state.mode === 'recording' || state.mode === 'transcribing') {
    await stopMic('awake');
    return;
  }
  if (state.mode === 'awake') {
    await enterSleep();
    return;
  }
  await enterAwake();
}

if (els.saveButton) {
  els.saveButton.addEventListener('click', async () => {
    applyConfig(await desktop.writeConfig(authSessionFields(readFormConfig())));
    if (state.config?.deviceId && state.config?.deviceToken) {
      await loadDashboard().catch((err) => showStatus(err.message));
    } else {
      updateAuthStatus('idle', 'Settings saved. Sign in to connect this desktop.');
    }
  });
}
if (els.pairButton) {
  els.pairButton.addEventListener('click', () => pairDevice().catch((err) => showStatus(err.message)));
}
els.primaryVoiceButton.addEventListener('click', () => togglePrimaryVoice().catch((err) => showStatus(err.message)));
els.offButton.addEventListener('click', () => turnOff().catch((err) => showStatus(err.message)));
els.compactButton.addEventListener('click', () => {
  if (desktop.compactWindow) void desktop.compactWindow().then(applyWindowState);
});
els.expandButton.addEventListener('click', () => {
  if (desktop.expandWindow) void desktop.expandWindow().then(applyWindowState);
});
els.closeButton.addEventListener('click', () => {
  if (desktop.closeWindow) void desktop.closeWindow();
});
els.authCloseButton.addEventListener('click', () => {
  if (desktop.closeWindow) void desktop.closeWindow();
});
if (els.signOutButton) {
  els.signOutButton.addEventListener('click', () => {
    void clearSavedDevice('Desktop disconnected. Sign in to reconnect.').catch((err) => showStatus(err.message));
  });
}
els.openWebButton.addEventListener('click', () => {
  const config = readFormConfig();
  void desktop.openExternal(deriveWebUrl(config) || config.serverUrl);
});
els.signInButton.addEventListener('click', () => {
  void signInWithBrowser().catch((err) => updateAuthStatus('error', err?.message || 'Could not start sign in.'));
});
if (els.inputDeviceButton) {
  els.inputDeviceButton.addEventListener('click', () => toggleDevicePicker(els.inputDeviceSelect));
}
if (els.outputDeviceButton) {
  els.outputDeviceButton.addEventListener('click', () => toggleDevicePicker(els.outputDeviceSelect));
}
if (els.settingsButton) {
  els.settingsButton.addEventListener('click', () => toggleSettingsPanel());
}
if (els.inputDeviceSelect) {
  els.inputDeviceSelect.addEventListener('change', () => {
    renderDevicePicker(els.inputDeviceSelect);
    void saveAudioDeviceSelection()
      .then(restartWakeListenerForDeviceChange)
      .catch((err) => showStatus(err?.message || 'Could not save input device.'));
  });
}
if (els.outputDeviceSelect) {
  els.outputDeviceSelect.addEventListener('change', () => {
    renderDevicePicker(els.outputDeviceSelect);
    void saveAudioDeviceSelection().catch((err) => showStatus(err?.message || 'Could not save output device.'));
  });
}
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.settings-popover')) closeSettingsPanel();
  if (target.closest('.device-picker')) return;
  closeDeviceMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsPanel();
});
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    void refreshAudioDevicePickers();
  });
}

if (desktop.onPairingPayload) {
  desktop.onPairingPayload((payload) => {
    void applyPairingPayload(payload).catch((err) => showPairingMessage(err.message, 'error'));
  });
}

if (desktop.onWindowState) {
  desktop.onWindowState(applyWindowState);
}

if (desktop.windowState) {
  desktop.windowState().then(applyWindowState).catch(() => applyWindowState({ compact: true }));
}

desktop.readConfig().then((config) => {
  applyConfig(config);
  void refreshAudioDevicePickers();
  applyWindowState({ compact: state.compact });
  if (!config.deviceId || !config.deviceToken) {
    updateVoiceButtons();
    showStatus('Sign in to start voice.');
    showPairingMessage('Browser sign-in will connect this desktop automatically.');
    return null;
  }
  ensureControlSocket();
  updateVoiceButtons();
  return loadDashboard();
}).catch((err) => showStatus(err.message));
