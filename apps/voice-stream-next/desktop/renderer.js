const desktop = window.voiceStreamDesktop;

const VOICE_PCM_SAMPLE_RATE_HZ = 16000;
const PRE_ROLL_MAX_BYTES = pcmBytesForMs(1500);
const MAX_PENDING_STREAM_BYTES = pcmBytesForMs(5000);
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_EXPONENT = 4;
const SLEEP_PHRASE_STABLE_MS = 650;
const SLEEP_PHRASE_MIN_HITS = 2;
const SLEEP_PHRASE_MAX_GAP_MS = 1500;
// Keep the status command path available, but do not match spoken status phrases locally.
const ENABLE_STATUS_WAKE_COMMAND = false;
const DEFAULT_TRANSCRIPTION_SHORTCUT = {
  key: 'space',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};
const DEFAULT_AWAKE_SLEEP_TOGGLE_SHORTCUT = {
  key: 'a',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};
const DEFAULT_TURN_OFF_SHORTCUT = {
  key: 'o',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};
const DEFAULT_PAUSE_RESUME_SHORTCUT = {
  key: 'p',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};
const DEFAULT_ASSISTANT_RECORDING_SHORTCUT = {
  key: 'r',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
};
const MODIFIER_ONLY_SHORTCUT_KEYS = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'os']);

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
  voiceStreamStarting: false,
  wakeUsesVosk: false,
  controlSocket: null,
  voiceSessionId: null,
  voiceTarget: 'assistant',
  voiceAssistantProfileId: null,
  voiceSuppressCommands: false,
  recordingPaused: false,
  transcriptionShortcutActive: false,
  transcriptionReturnMode: null,
  transcriptionReturnStatus: '',
  transcriptionOverlayRestore: null,
  mode: 'off',
  voiceSettings: null,
  recognition: null,
  wakeStream: null,
  wakeAudioContext: null,
  wakeAnalyser: null,
  wakeProcessor: null,
  wakeUnsubscribe: null,
  wakeStarting: false,
  capturingShortcutKey: null,
  shortcutStatus: null,
  lastTranscriptionShortcutAt: 0,
  lastRecognizedText: '',
  lastRecognizedAt: 0,
  sleepPhraseCandidate: null,
  sleepPhraseTimer: null,
  commandLogs: [],
  callRecorder: null,
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
  refreshQrButton: document.querySelector('#refreshQrButton'),
  signOutButton: document.querySelector('#signOutButton'),
  authCloseButton: document.querySelector('#authCloseButton'),
  compactButton: document.querySelector('#compactButton'),
  closeButton: document.querySelector('#closeButton'),
  expandButton: document.querySelector('#expandButton'),
  saveButton: document.querySelector('#saveButton'),
  serverUrlInput: document.querySelector('#serverUrlInput'),
  deviceNameInput: document.querySelector('#deviceNameInput'),
  authStatus: document.querySelector('#authStatus'),
  desktopAuthQrImage: document.querySelector('#desktopAuthQrImage'),
  desktopAuthQrPlaceholder: document.querySelector('#desktopAuthQrPlaceholder'),
  desktopAuthQrStatus: document.querySelector('#desktopAuthQrStatus'),
  pairingMessage: document.querySelector('#pairingMessage'),
  voiceAuthStatus: document.querySelector('#voiceAuthStatus'),
  voicePairingMessage: document.querySelector('#voicePairingMessage'),
  pairButton: document.querySelector('#pairButton'),
  primaryVoiceButton: document.querySelector('#primaryVoiceButton'),
  primaryVoiceMode: document.querySelector('#primaryVoiceMode'),
  primaryVoiceAction: document.querySelector('#primaryVoiceAction'),
  offButton: document.querySelector('#offButton'),
  assistantSpeechPlaybackButton: document.querySelector('#assistantSpeechPlaybackButton'),
  micStatus: document.querySelector('#micStatus'),
  meterBar: document.querySelector('#meterBar'),
  inputDeviceSelect: document.querySelector('#inputDeviceSelect'),
  outputDeviceSelect: document.querySelector('#outputDeviceSelect'),
  suppressWakeDuringPlaybackCheckbox: document.querySelector('#suppressWakeDuringPlaybackCheckbox'),
  inputDeviceButton: document.querySelector('#inputDeviceButton'),
  inputDeviceLabel: document.querySelector('#inputDeviceLabel'),
  inputDeviceMenu: document.querySelector('#inputDeviceMenu'),
  outputDeviceButton: document.querySelector('#outputDeviceButton'),
  outputDeviceLabel: document.querySelector('#outputDeviceLabel'),
  outputDeviceMenu: document.querySelector('#outputDeviceMenu'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
  audioSettingsTab: document.querySelector('#audioSettingsTab'),
  shortcutsSettingsTab: document.querySelector('#shortcutsSettingsTab'),
  logsSettingsTab: document.querySelector('#logsSettingsTab'),
  audioSettingsPanel: document.querySelector('#audioSettingsPanel'),
  shortcutsSettingsPanel: document.querySelector('#shortcutsSettingsPanel'),
  logsSettingsPanel: document.querySelector('#logsSettingsPanel'),
  transcriptionShortcutCapture: document.querySelector('#transcriptionShortcutCapture'),
  transcriptionShortcutClear: document.querySelector('#transcriptionShortcutClear'),
  transcriptionShortcutReset: document.querySelector('#transcriptionShortcutReset'),
  transcriptionShortcutStatus: document.querySelector('#transcriptionShortcutStatus'),
  awakeSleepToggleShortcutCapture: document.querySelector('#awakeSleepToggleShortcutCapture'),
  awakeSleepToggleShortcutClear: document.querySelector('#awakeSleepToggleShortcutClear'),
  awakeSleepToggleShortcutReset: document.querySelector('#awakeSleepToggleShortcutReset'),
  awakeSleepToggleShortcutStatus: document.querySelector('#awakeSleepToggleShortcutStatus'),
  turnOffShortcutCapture: document.querySelector('#turnOffShortcutCapture'),
  turnOffShortcutClear: document.querySelector('#turnOffShortcutClear'),
  turnOffShortcutReset: document.querySelector('#turnOffShortcutReset'),
  turnOffShortcutStatus: document.querySelector('#turnOffShortcutStatus'),
  pauseResumeShortcutCapture: document.querySelector('#pauseResumeShortcutCapture'),
  pauseResumeShortcutClear: document.querySelector('#pauseResumeShortcutClear'),
  pauseResumeShortcutReset: document.querySelector('#pauseResumeShortcutReset'),
  pauseResumeShortcutStatus: document.querySelector('#pauseResumeShortcutStatus'),
  assistantRecordingShortcutList: document.querySelector('#assistantRecordingShortcutList'),
  commandLogList: document.querySelector('#commandLogList'),
  commandLogStatus: document.querySelector('#commandLogStatus'),
  refreshCommandLogsButton: document.querySelector('#refreshCommandLogsButton'),
  copyCommandLogsButton: document.querySelector('#copyCommandLogsButton'),
  clearCommandLogsButton: document.querySelector('#clearCommandLogsButton'),
  callRecorderButton: document.querySelector('#callRecorderButton'),
  callRecorderAction: document.querySelector('#callRecorderAction'),
  callRecorderOpenButton: document.querySelector('#callRecorderOpenButton'),
  callRecorderStatus: document.querySelector('#callRecorderStatus'),
  extensionsConfigInput: document.querySelector('#extensionsConfigInput'),
  addExtensionFileButton: document.querySelector('#addExtensionFileButton'),
  extensionDropzone: document.querySelector('#extensionDropzone'),
  saveExtensionsButton: document.querySelector('#saveExtensionsButton'),
  reloadExtensionsButton: document.querySelector('#reloadExtensionsButton'),
  enableWorkspaceExtensionButton: document.querySelector('#enableWorkspaceExtensionButton'),
  addWorkspaceRootButton: document.querySelector('#addWorkspaceRootButton'),
  workspaceRootsStatus: document.querySelector('#workspaceRootsStatus'),
  workspaceRootsList: document.querySelector('#workspaceRootsList'),
  extensionsStatus: document.querySelector('#extensionsStatus'),
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
    ? `Click Sign in in this desktop app. It opens ${webUrl} and connects after the browser tab says Device connected.`
    : 'Click Sign in in this desktop app, then finish the browser handoff.';
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
    assistantSpeechPlaybackEnabled: state.config?.assistantSpeechPlaybackEnabled !== false,
    suppressWakeDuringPlayback: els.suppressWakeDuringPlaybackCheckbox?.checked === true,
    transcriptionShortcut: sanitizeShortcutBinding(state.config?.transcriptionShortcut, DEFAULT_TRANSCRIPTION_SHORTCUT),
    awakeSleepToggleShortcut: sanitizeShortcutBinding(state.config?.awakeSleepToggleShortcut, DEFAULT_AWAKE_SLEEP_TOGGLE_SHORTCUT),
    turnOffShortcut: sanitizeShortcutBinding(state.config?.turnOffShortcut, DEFAULT_TURN_OFF_SHORTCUT),
    pauseResumeShortcut: sanitizeShortcutBinding(state.config?.pauseResumeShortcut, DEFAULT_PAUSE_RESUME_SHORTCUT),
    assistantRecordingShortcuts: sanitizeAssistantRecordingShortcuts(state.config?.assistantRecordingShortcuts),
  };
}

function normalizeShortcutKey(raw) {
  const key = String(raw ?? '');
  if (!key) return '';
  if (key === ' ') return 'space';
  const lower = key.trim().toLowerCase();
  if (!lower) return '';
  if (lower === 'spacebar') return 'space';
  if (lower === 'esc') return 'escape';
  if (lower === 'return') return 'enter';
  return lower;
}

function cloneShortcutBinding(binding) {
  return binding ? { ...binding } : null;
}

function sanitizeShortcutBinding(value, fallback = null) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneShortcutBinding(fallback);
  const key = normalizeShortcutKey(value.key);
  if (!key || MODIFIER_ONLY_SHORTCUT_KEYS.has(key)) return cloneShortcutBinding(fallback);
  const mod = value.mod === true;
  return {
    key,
    mod,
    ctrl: mod ? false : value.ctrl === true,
    meta: mod ? false : value.meta === true,
    alt: value.alt === true,
    altGraph: value.altGraph === true,
    shift: value.shift === true,
  };
}

function assistantRecordingShortcutId(assistantProfileId) {
  const profileId = String(assistantProfileId || '').trim();
  return profileId ? `profile:${profileId}` : 'default';
}

function sanitizeAssistantRecordingShortcuts(value) {
  const entries = Array.isArray(value)
    ? value
    : [{ id: 'default', assistantProfileId: null, label: 'Default assistant', binding: DEFAULT_ASSISTANT_RECORDING_SHORTCUT }];
  const seen = new Set();
  const shortcuts = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const assistantProfileId = String(entry.assistantProfileId || '').trim() || null;
    const id = String(entry.id || assistantRecordingShortcutId(assistantProfileId)).trim() || assistantRecordingShortcutId(assistantProfileId);
    if (seen.has(id)) continue;
    seen.add(id);
    shortcuts.push({
      id,
      assistantProfileId,
      label: String(entry.label || '').trim(),
      binding: sanitizeShortcutBinding(entry.binding, id === 'default' ? DEFAULT_ASSISTANT_RECORDING_SHORTCUT : null),
    });
  }
  if (!seen.has('default')) {
    shortcuts.unshift({
      id: 'default',
      assistantProfileId: null,
      label: 'Default assistant',
      binding: cloneShortcutBinding(DEFAULT_ASSISTANT_RECORDING_SHORTCUT),
    });
  }
  return shortcuts;
}

function assistantRecordingShortcutForProfile(assistantProfileId = null) {
  const id = assistantRecordingShortcutId(assistantProfileId);
  const shortcuts = sanitizeAssistantRecordingShortcuts(state.config?.assistantRecordingShortcuts);
  return shortcuts.find((entry) => entry.id === id) || {
    id,
    assistantProfileId: assistantProfileId || null,
    label: '',
    binding: id === 'default' ? cloneShortcutBinding(DEFAULT_ASSISTANT_RECORDING_SHORTCUT) : null,
  };
}

function enabledAssistantProfiles() {
  const profiles = Array.isArray(state.voiceSettings?.assistantProfiles) ? state.voiceSettings.assistantProfiles : [];
  return profiles.filter((profile) => profile?.enabled !== false);
}

function assistantProfileName(assistantProfileId) {
  const profileId = String(assistantProfileId || '').trim();
  if (!profileId) return 'default assistant';
  const profile = enabledAssistantProfiles().find((entry) => String(entry?.id || '') === profileId);
  return profile?.name || 'assistant profile';
}

function numpadShortcutKeyFromCode(code) {
  const value = String(code || '');
  const digit = /^Numpad([0-9])$/.exec(value);
  if (digit) return `num${digit[1]}`;
  const map = {
    NumpadDecimal: 'numdec',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadEnter: 'numenter',
  };
  return map[value] || '';
}

function shortcutKeyFromKeyboardEvent(event) {
  return numpadShortcutKeyFromCode(event.code) || normalizeShortcutKey(event.key);
}

function shortcutBindingFromKeyboardEvent(event) {
  const key = shortcutKeyFromKeyboardEvent(event);
  if (!key || MODIFIER_ONLY_SHORTCUT_KEYS.has(key)) return null;
  const altGraph = typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');
  const hasSinglePrimaryModifier = event.ctrlKey !== event.metaKey;
  const usePortablePrimaryModifier = hasSinglePrimaryModifier && !altGraph;
  return {
    key,
    mod: usePortablePrimaryModifier,
    ctrl: usePortablePrimaryModifier || altGraph ? false : event.ctrlKey,
    meta: usePortablePrimaryModifier ? false : event.metaKey,
    alt: altGraph ? false : event.altKey,
    altGraph,
    shift: event.shiftKey,
  };
}

function isShortcutMatch(binding, event) {
  if (!binding) return false;
  const eventKey = shortcutKeyFromKeyboardEvent(event);
  if (!eventKey || eventKey !== binding.key) return false;
  const eventAltGraph = typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');
  const eventCtrl = eventAltGraph ? false : event.ctrlKey;
  const eventAlt = eventAltGraph ? false : event.altKey;
  if (binding.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false;
  } else {
    if (eventCtrl !== binding.ctrl) return false;
    if (event.metaKey !== binding.meta) return false;
  }
  if (eventAlt !== binding.alt) return false;
  if (eventAltGraph !== (binding.altGraph === true)) return false;
  if (event.shiftKey !== binding.shift) return false;
  return true;
}

function shortcutKeyLabel(key) {
  if (/^num[0-9]$/.test(key)) return `Numpad ${key.slice(3)}`;
  if (key === 'numdec') return 'Numpad .';
  if (key === 'numadd') return 'Numpad +';
  if (key === 'numsub') return 'Numpad -';
  if (key === 'nummult') return 'Numpad *';
  if (key === 'numdiv') return 'Numpad /';
  if (key === 'numenter') return 'Numpad Enter';
  if (key === 'space') return 'Space';
  if (key === 'escape') return 'Esc';
  if (key === 'arrowup') return 'Up';
  if (key === 'arrowdown') return 'Down';
  if (key === 'arrowleft') return 'Left';
  if (key === 'arrowright') return 'Right';
  if (key === 'pageup') return 'Page Up';
  if (key === 'pagedown') return 'Page Down';
  if (key === 'capslock') return 'Caps Lock';
  if (key === 'backspace') return 'Backspace';
  if (key === 'delete') return 'Delete';
  if (key === 'insert') return 'Insert';
  if (key === 'home') return 'Home';
  if (key === 'end') return 'End';
  if (key === 'tab') return 'Tab';
  if (key === 'enter') return 'Enter';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatShortcutBinding(binding) {
  if (!binding) return 'Not set';
  const parts = [];
  if (binding.mod) parts.push('Ctrl/Cmd');
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Meta');
  if (binding.alt) parts.push('Alt');
  if (binding.altGraph) parts.push('AltGr');
  if (binding.shift) parts.push('Shift');
  parts.push(shortcutKeyLabel(binding.key));
  return parts.join('+');
}

function extensionConfigText(config = state.config) {
  const extensions = Array.isArray(config?.extensions) ? config.extensions : [];
  return extensions.length > 0 ? JSON.stringify(extensions, null, 2) : '';
}

function workspaceExtensionConfig(config = state.config) {
  const extensions = Array.isArray(config?.extensions) ? config.extensions : [];
  return extensions.find((entry) => String(entry?.id || '') === 'workspace') || null;
}

function workspaceRootsFromConfig(config = state.config) {
  const workspace = workspaceExtensionConfig(config);
  return Array.isArray(workspace?.config?.workspaceRoots) ? workspace.config.workspaceRoots.filter(Boolean) : [];
}

function renderWorkspaceExtensionConfig(config = state.config) {
  if (!els.workspaceRootsStatus) return;
  const workspace = workspaceExtensionConfig(config);
  if (!workspace || workspace.enabled === false) {
    els.workspaceRootsStatus.textContent = 'Not enabled.';
    if (els.enableWorkspaceExtensionButton) els.enableWorkspaceExtensionButton.textContent = 'Enable';
    if (els.workspaceRootsList) {
      els.workspaceRootsList.replaceChildren();
      els.workspaceRootsList.hidden = true;
    }
    return;
  }
  const roots = workspaceRootsFromConfig(config);
  els.workspaceRootsStatus.textContent = roots.length > 0
    ? `${roots.length} workspace root${roots.length === 1 ? '' : 's'} configured.`
    : 'Enabled. Add at least one root for useful file access.';
  if (els.enableWorkspaceExtensionButton) els.enableWorkspaceExtensionButton.textContent = 'Enabled';
  renderWorkspaceRootsList(roots);
}

function renderWorkspaceRootsList(roots) {
  if (!els.workspaceRootsList) return;
  els.workspaceRootsList.replaceChildren();
  if (roots.length === 0) {
    els.workspaceRootsList.hidden = true;
    return;
  }
  els.workspaceRootsList.hidden = false;
  roots.forEach((root, index) => {
    const row = document.createElement('div');
    row.className = 'workspace-root-row';

    const pathEl = document.createElement('span');
    pathEl.className = 'workspace-root-path';
    pathEl.textContent = String(root);
    pathEl.title = String(root);
    row.appendChild(pathEl);

    const actions = document.createElement('div');
    actions.className = 'workspace-root-actions';
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'secondary mini-button';
    moveUp.textContent = 'Up';
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => {
      const nextRoots = [...roots];
      [nextRoots[index - 1], nextRoots[index]] = [nextRoots[index], nextRoots[index - 1]];
      void saveWorkspaceRoots(nextRoots, 'Moved workspace root up.');
    });
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'secondary mini-button';
    moveDown.textContent = 'Down';
    moveDown.disabled = index === roots.length - 1;
    moveDown.addEventListener('click', () => {
      const nextRoots = [...roots];
      [nextRoots[index], nextRoots[index + 1]] = [nextRoots[index + 1], nextRoots[index]];
      void saveWorkspaceRoots(nextRoots, 'Moved workspace root down.');
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary mini-button danger-mini-button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      void saveWorkspaceRoots(roots.filter((_, rootIndex) => rootIndex !== index), 'Removed workspace root.');
    });
    actions.append(moveUp, moveDown, remove);
    row.appendChild(actions);
    els.workspaceRootsList.appendChild(row);
  });
}

function isAbsoluteExtensionPath(value) {
  return typeof value === 'string' && (/^\//.test(value.trim()) || /^[a-zA-Z]:[\\/]/.test(value.trim()));
}

function validateExtensionConfig(extensions) {
  extensions.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Extension ${index + 1} must be an object.`);
    }
    if (entry.enabled === false) return;
    const name = String(entry.name || entry.id || `Extension ${index + 1}`);
    if (!isAbsoluteExtensionPath(entry.path)) {
      throw new Error(`${name} needs an absolute path.`);
    }
  });
}

function renderExtensionStatus(result) {
  if (!els.extensionsStatus) return;
  const statuses = Array.isArray(result?.statuses) ? result.statuses : [];
  if (statuses.length === 0) {
    els.extensionsStatus.className = 'extensions-status muted';
    els.extensionsStatus.textContent = 'No local extensions configured.';
    return;
  }
  els.extensionsStatus.className = 'extensions-status';
  els.extensionsStatus.innerHTML = '';
  for (const status of statuses) {
    const row = document.createElement('div');
    row.className = status.ok ? 'ok' : 'error';
    const name = String(status.name || status.id || 'Extension');
    const toolText = `${status.toolCount || 0} tool(s)`;
    const skillText = status.skillCount ? `, ${status.skillCount} skill(s)` : '';
    row.textContent = status.ok
      ? `${name}: ${status.enabled === false ? 'disabled' : `${toolText}${skillText}`}`
      : `${name}: ${status.error || 'failed to load'}`;
    els.extensionsStatus.appendChild(row);
  }
}

async function refreshExtensionStatus() {
  if (!desktop.extensionStatus) return;
  try {
    renderExtensionStatus(await desktop.extensionStatus());
  } catch (err) {
    if (els.extensionsStatus) {
      els.extensionsStatus.className = 'extensions-status error';
      els.extensionsStatus.textContent = err?.message || 'Could not load extensions.';
    }
  }
}

function pathForFile(file) {
  if (!file) return '';
  if (desktop.pathForFile) return desktop.pathForFile(file);
  return typeof file.path === 'string' ? file.path : '';
}

async function applyExtensionImport(result, successMessage) {
  if (!result || result.canceled) return;
  if (result.config) applyConfig(result.config);
  renderExtensionStatus(result);
  const entryName = result.entry?.name || result.entry?.id || 'extension';
  showStatus(successMessage || `Added ${entryName}.`);
}

async function addExtensionFilePath(filePath) {
  if (!desktop.addExtensionFile) throw new Error('Extension file import is not available.');
  const result = await desktop.addExtensionFile(filePath);
  await applyExtensionImport(result);
}

async function chooseExtensionFile() {
  if (!desktop.chooseExtensionFile) throw new Error('Extension file picker is not available.');
  const result = await desktop.chooseExtensionFile();
  await applyExtensionImport(result);
}

async function saveWorkspaceRoots(roots, successMessage) {
  if (!desktop.saveWorkspaceRoots) throw new Error('Workspace root management is not available.');
  const result = await desktop.saveWorkspaceRoots(roots);
  applyConfig(result.config);
  renderExtensionStatus(result);
  showStatus(successMessage || 'Saved workspace roots.');
}

function applyConfig(config) {
  state.config = {
    ...config,
    transcriptionShortcut: sanitizeShortcutBinding(config?.transcriptionShortcut, DEFAULT_TRANSCRIPTION_SHORTCUT),
    awakeSleepToggleShortcut: sanitizeShortcutBinding(config?.awakeSleepToggleShortcut, DEFAULT_AWAKE_SLEEP_TOGGLE_SHORTCUT),
    turnOffShortcut: sanitizeShortcutBinding(config?.turnOffShortcut, DEFAULT_TURN_OFF_SHORTCUT),
    pauseResumeShortcut: sanitizeShortcutBinding(config?.pauseResumeShortcut, DEFAULT_PAUSE_RESUME_SHORTCUT),
    assistantRecordingShortcuts: sanitizeAssistantRecordingShortcuts(config?.assistantRecordingShortcuts),
    assistantSpeechPlaybackEnabled: config?.assistantSpeechPlaybackEnabled !== false,
    suppressWakeDuringPlayback: config?.suppressWakeDuringPlayback === true,
  };
  if (els.serverUrlInput) els.serverUrlInput.value = config.serverUrl;
  if (els.deviceNameInput) els.deviceNameInput.value = config.deviceName;
  if (els.inputDeviceSelect) els.inputDeviceSelect.value = config.inputDeviceId || '';
  if (els.outputDeviceSelect) els.outputDeviceSelect.value = config.outputDeviceId || '';
  renderAssistantSpeechPlaybackButton();
  if (els.suppressWakeDuringPlaybackCheckbox) els.suppressWakeDuringPlaybackCheckbox.checked = state.config.suppressWakeDuringPlayback === true;
  if (els.extensionsConfigInput) els.extensionsConfigInput.value = extensionConfigText(config);
  renderWorkspaceExtensionConfig(config);
  renderShortcutSettings();
  renderDevicePicker(els.inputDeviceSelect);
  renderDevicePicker(els.outputDeviceSelect);
  setPreferredOutputDevice(state.config.outputDeviceId);
  const connected = Boolean(state.config.deviceId && state.config.deviceToken);
  document.body.classList.toggle('is-signed-in', connected);
  document.body.classList.toggle('is-signed-out', !connected);
  document.body.classList.toggle('is-compact', connected && state.compact);
  els.compactButton.hidden = state.compact || !connected;
  els.expandButton.hidden = !state.compact || !connected;
  debugWindow('renderer:applyConfig', {
    connected,
    deviceId: state.config.deviceId ? `${state.config.deviceId.slice(0, 12)}...` : '',
    hasDeviceToken: Boolean(state.config.deviceToken),
    serverUrl: state.config.serverUrl,
  });
  if (!connected) ensureSignedOutWindowExpanded();
  updateConnection('idle', state.config.deviceId ? 'Desktop connected' : 'Ready', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : 'No device connected');
  if (els.accountLabel) els.accountLabel.textContent = connected ? 'Connected' : 'Signed out';
  if (els.accountDetail) els.accountDetail.textContent = connected ? state.config.deviceName : 'Sign in required';
  if (connected) {
    updateAuthStatus('ok', 'Desktop connected.');
  } else {
    updateAuthStatus('idle', 'Sign in with your browser to connect this desktop.');
  }
}

function normalizeShortcutStatusPayload(status) {
  if (!status) return null;
  if (status.transcription || status.awakeSleepToggle || status.turnOff || status.pauseResume || status.assistantRecording) return status;
  if (typeof status.registered === 'boolean') return { transcription: status };
  return status;
}

function renderShortcutSettings() {
  const specs = [
    {
      configKey: 'transcriptionShortcut',
      defaultBinding: DEFAULT_TRANSCRIPTION_SHORTCUT,
      captureEl: els.transcriptionShortcutCapture,
      clearEl: els.transcriptionShortcutClear,
      statusEl: els.transcriptionShortcutStatus,
      statusKey: 'transcription',
      disabledLabel: 'Background transcription shortcut is disabled.',
    },
    {
      configKey: 'awakeSleepToggleShortcut',
      defaultBinding: DEFAULT_AWAKE_SLEEP_TOGGLE_SHORTCUT,
      captureEl: els.awakeSleepToggleShortcutCapture,
      clearEl: els.awakeSleepToggleShortcutClear,
      statusEl: els.awakeSleepToggleShortcutStatus,
      statusKey: 'awakeSleepToggle',
      disabledLabel: 'Awake and sleep toggle shortcut is disabled.',
    },
    {
      configKey: 'turnOffShortcut',
      defaultBinding: DEFAULT_TURN_OFF_SHORTCUT,
      captureEl: els.turnOffShortcutCapture,
      clearEl: els.turnOffShortcutClear,
      statusEl: els.turnOffShortcutStatus,
      statusKey: 'turnOff',
      disabledLabel: 'Turn off shortcut is disabled.',
    },
    {
      configKey: 'pauseResumeShortcut',
      defaultBinding: DEFAULT_PAUSE_RESUME_SHORTCUT,
      captureEl: els.pauseResumeShortcutCapture,
      clearEl: els.pauseResumeShortcutClear,
      statusEl: els.pauseResumeShortcutStatus,
      statusKey: 'pauseResume',
      disabledLabel: 'Pause and resume shortcut is disabled.',
    },
  ];
  const statuses = normalizeShortcutStatusPayload(state.shortcutStatus);
  for (const spec of specs) {
    const binding = sanitizeShortcutBinding(state.config?.[spec.configKey], spec.defaultBinding);
    if (spec.captureEl && state.capturingShortcutKey !== spec.configKey) {
      spec.captureEl.textContent = formatShortcutBinding(binding);
    }
    if (spec.clearEl) spec.clearEl.disabled = !binding;
    renderShortcutStatusEl(spec.statusEl, binding, statuses?.[spec.statusKey], spec.disabledLabel);
  }
  renderAssistantRecordingShortcutSettings(statuses?.assistantRecording || {});
}

function renderShortcutStatusEl(statusEl, binding, status, disabledLabel) {
  if (!statusEl) return;
  if (!binding) {
    statusEl.className = 'shortcut-status muted';
    statusEl.textContent = disabledLabel;
    return;
  }
  if (!status) {
    statusEl.className = 'shortcut-status muted';
    statusEl.textContent = 'Checking shortcut registration.';
    return;
  }
  if (status.registered) {
    statusEl.className = 'shortcut-status ok';
    statusEl.textContent = `Registered globally: ${status.label || formatShortcutBinding(binding)}.`;
    return;
  }
  statusEl.className = 'shortcut-status error';
  statusEl.textContent = status.error || 'Shortcut could not be registered globally.';
}

function assistantRecordingShortcutRows() {
  const rows = [
    {
      id: 'default',
      assistantProfileId: null,
      name: 'Default assistant',
      kind: 'Default',
      binding: assistantRecordingShortcutForProfile(null).binding,
    },
  ];
  for (const profile of enabledAssistantProfiles()) {
    const profileId = String(profile?.id || '').trim();
    if (!profileId) continue;
    const shortcut = assistantRecordingShortcutForProfile(profileId);
    rows.push({
      id: assistantRecordingShortcutId(profileId),
      assistantProfileId: profileId,
      name: profile.name || profile.wakePhrase || 'Assistant profile',
      kind: 'Profile',
      binding: shortcut.binding,
    });
  }
  return rows;
}

function renderAssistantRecordingShortcutSettings(statuses = {}) {
  if (!els.assistantRecordingShortcutList) return;
  els.assistantRecordingShortcutList.replaceChildren();
  for (const row of assistantRecordingShortcutRows()) {
    const configKey = `assistantRecordingShortcuts:${row.id}`;
    const item = document.createElement('div');
    item.className = 'assistant-shortcut-item';

    const title = document.createElement('div');
    title.className = 'assistant-shortcut-title';
    const name = document.createElement('span');
    name.className = 'assistant-shortcut-name';
    name.textContent = row.name;
    const kind = document.createElement('span');
    kind.className = 'assistant-shortcut-kind';
    kind.textContent = row.kind;
    title.append(name, kind);

    const shortcutRow = document.createElement('div');
    shortcutRow.className = 'shortcut-row';
    const capture = document.createElement('button');
    capture.className = 'shortcut-capture';
    capture.type = 'button';
    capture.dataset.shortcutCapture = 'true';
    capture.dataset.shortcutId = row.id;
    capture.textContent = state.capturingShortcutKey === configKey ? 'Press keys...' : formatShortcutBinding(row.binding);
    if (state.capturingShortcutKey === configKey) capture.classList.add('is-capturing');

    const clear = document.createElement('button');
    clear.className = 'secondary mini-button';
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.disabled = !row.binding;

    const reset = document.createElement('button');
    reset.className = 'secondary mini-button';
    reset.type = 'button';
    reset.textContent = row.id === 'default' ? 'Reset' : 'Unset';
    reset.disabled = row.id !== 'default' && !row.binding;

    shortcutRow.append(capture, clear, reset);

    const status = document.createElement('p');
    status.className = 'shortcut-status muted';
    const disabledLabel = row.id === 'default'
      ? 'Assistant recording shortcut is disabled.'
      : `${row.name} recording shortcut is disabled.`;
    renderShortcutStatusEl(status, row.binding, statuses?.[row.id], disabledLabel);

    item.append(title, shortcutRow, status);
    els.assistantRecordingShortcutList.append(item);

    capture.addEventListener('click', () => {
      state.capturingShortcutKey = configKey;
      renderShortcutSettings();
      focusAssistantShortcutCapture(row.id);
    });
    capture.addEventListener('blur', () => {
      if (state.capturingShortcutKey !== configKey) return;
      state.capturingShortcutKey = null;
      renderShortcutSettings();
    });
    capture.addEventListener('keydown', (event) => {
      if (state.capturingShortcutKey !== configKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        state.capturingShortcutKey = null;
        renderShortcutSettings();
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        state.capturingShortcutKey = null;
        void saveAssistantRecordingShortcut(row.assistantProfileId, null, row.name).catch((err) => showStatus(err?.message || 'Could not save shortcut.'));
        return;
      }
      const next = shortcutBindingFromKeyboardEvent(event);
      if (!next) return;
      state.capturingShortcutKey = null;
      void saveAssistantRecordingShortcut(row.assistantProfileId, next, row.name).catch((err) => showStatus(err?.message || 'Could not save shortcut.'));
    });
    clear.addEventListener('click', () => {
      void saveAssistantRecordingShortcut(row.assistantProfileId, null, row.name).catch((err) => showStatus(err?.message || 'Could not clear shortcut.'));
    });
    reset.addEventListener('click', () => {
      const nextBinding = row.id === 'default' ? DEFAULT_ASSISTANT_RECORDING_SHORTCUT : null;
      void saveAssistantRecordingShortcut(row.assistantProfileId, nextBinding, row.name).catch((err) => showStatus(err?.message || 'Could not reset shortcut.'));
    });
  }
}

function focusAssistantShortcutCapture(rowId) {
  if (!els.assistantRecordingShortcutList) return;
  const buttons = els.assistantRecordingShortcutList.querySelectorAll('.shortcut-capture');
  for (const button of buttons) {
    if (button.dataset.shortcutId === rowId) {
      button.focus();
      return;
    }
  }
}

async function saveConfigShortcut(configKey, binding) {
  if (!state.config) return;
  const next = await desktop.writeConfig({
    ...state.config,
    [configKey]: sanitizeShortcutBinding(binding, null),
  });
  applyConfig(next);
  if (desktop.shortcutStatus) {
    state.shortcutStatus = await desktop.shortcutStatus().catch(() => state.shortcutStatus);
    renderShortcutSettings();
  }
}

async function saveAssistantRecordingShortcut(assistantProfileId, binding, label = '') {
  if (!state.config) return;
  const id = assistantRecordingShortcutId(assistantProfileId);
  const sanitizedBinding = sanitizeShortcutBinding(binding, null);
  const existing = sanitizeAssistantRecordingShortcuts(state.config.assistantRecordingShortcuts)
    .filter((entry) => entry.id !== id);
  const nextShortcuts = [
    ...existing,
    {
      id,
      assistantProfileId: assistantProfileId || null,
      label: label || (assistantProfileId ? assistantProfileName(assistantProfileId) : 'Default assistant'),
      binding: sanitizedBinding,
    },
  ];
  const next = await desktop.writeConfig({
    ...state.config,
    assistantRecordingShortcuts: normalizeAssistantRecordingShortcutsForProfiles(nextShortcuts),
  });
  applyConfig(next);
  if (desktop.shortcutStatus) {
    state.shortcutStatus = await desktop.shortcutStatus().catch(() => state.shortcutStatus);
    renderShortcutSettings();
  }
}

function normalizeAssistantRecordingShortcutsForProfiles(shortcuts = sanitizeAssistantRecordingShortcuts(state.config?.assistantRecordingShortcuts)) {
  const byId = new Map(sanitizeAssistantRecordingShortcuts(shortcuts).map((entry) => [entry.id, entry]));
  const next = [];
  const defaultEntry = byId.get('default') || {
    id: 'default',
    assistantProfileId: null,
    label: 'Default assistant',
    binding: DEFAULT_ASSISTANT_RECORDING_SHORTCUT,
  };
  next.push({ ...defaultEntry, label: 'Default assistant', assistantProfileId: null });
  for (const profile of enabledAssistantProfiles()) {
    const profileId = String(profile?.id || '').trim();
    if (!profileId) continue;
    const id = assistantRecordingShortcutId(profileId);
    const existing = byId.get(id);
    if (existing) {
      next.push({
        ...existing,
        id,
        assistantProfileId: profileId,
        label: profile.name || existing.label || 'Assistant profile',
      });
    }
  }
  return next;
}

async function syncAssistantRecordingShortcutsWithProfiles() {
  if (!state.config) return;
  const current = sanitizeAssistantRecordingShortcuts(state.config.assistantRecordingShortcuts);
  const nextShortcuts = normalizeAssistantRecordingShortcutsForProfiles(current);
  if (JSON.stringify(current) === JSON.stringify(nextShortcuts)) return;
  applyConfig(await desktop.writeConfig({
    ...state.config,
    assistantRecordingShortcuts: nextShortcuts,
  }));
}

async function saveTranscriptionShortcut(binding) {
  return saveConfigShortcut('transcriptionShortcut', binding);
}

function bindShortcutControls({
  configKey,
  defaultBinding,
  captureEl,
  clearEl,
  resetEl,
  resetInvoker,
}) {
  if (!captureEl) return;
  captureEl.addEventListener('click', () => {
    state.capturingShortcutKey = configKey;
    captureEl.classList.add('is-capturing');
    captureEl.textContent = 'Press keys...';
    captureEl.focus();
  });
  captureEl.addEventListener('blur', () => {
    if (state.capturingShortcutKey !== configKey) return;
    state.capturingShortcutKey = null;
    captureEl.classList.remove('is-capturing');
    renderShortcutSettings();
  });
  captureEl.addEventListener('keydown', (event) => {
    if (state.capturingShortcutKey !== configKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      state.capturingShortcutKey = null;
      captureEl.classList.remove('is-capturing');
      renderShortcutSettings();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      state.capturingShortcutKey = null;
      captureEl.classList.remove('is-capturing');
      void saveConfigShortcut(configKey, null).catch((err) => showStatus(err?.message || 'Could not save shortcut.'));
      return;
    }
    const next = shortcutBindingFromKeyboardEvent(event);
    if (!next) return;
    state.capturingShortcutKey = null;
    captureEl.classList.remove('is-capturing');
    void saveConfigShortcut(configKey, next).catch((err) => showStatus(err?.message || 'Could not save shortcut.'));
  });
  if (clearEl) {
    clearEl.addEventListener('click', () => {
      void saveConfigShortcut(configKey, null).catch((err) => showStatus(err?.message || 'Could not clear shortcut.'));
    });
  }
  if (resetEl) {
    resetEl.addEventListener('click', () => {
      if (resetInvoker) {
        void resetInvoker()
          .then((result) => {
            if (result?.config) applyConfig(result.config);
            state.shortcutStatus = normalizeShortcutStatusPayload(result?.status || state.shortcutStatus);
            renderShortcutSettings();
          })
          .catch((err) => showStatus(err?.message || 'Could not reset shortcut.'));
        return;
      }
      void saveConfigShortcut(configKey, defaultBinding).catch((err) => showStatus(err?.message || 'Could not reset shortcut.'));
    });
  }
}

async function rememberReturnedDevice(device) {
  if (!device?.id || !state.config || device.id === state.config.deviceId) return;
  applyConfig(await desktop.writeConfig({
    ...state.config,
    deviceId: device.id,
    deviceName: device.displayName || state.config.deviceName,
  }));
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
  const { suppressAuthGuidance = false, ...fetchInit } = init;
  let response;
  try {
    response = await fetch(`${trimSlash(config.serverUrl)}${path}`, {
      ...fetchInit,
      headers: { ...headers(), ...(fetchInit.headers || {}) },
    });
  } catch (cause) {
    const message = serverConnectionErrorMessage(config.serverUrl);
    const err = new Error(message);
    err.cause = cause;
    err.serverUrl = trimSlash(config.serverUrl);
    updateConnection('error', 'Server offline', `Cannot reach ${trimSlash(config.serverUrl)}`);
    if (!suppressAuthGuidance) updateAuthStatus('error', message);
    throw err;
  }
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
    err.reason = body?.reason || '';
    if (!suppressAuthGuidance && (response.status === 401 || response.status === 403)) {
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

function normalizeCallRecorderStatus(status) {
  const mode = String(status?.mode || 'idle');
  return {
    ok: status?.ok !== false,
    mode: ['idle', 'recording', 'transcribing', 'saved', 'error'].includes(mode) ? mode : 'idle',
    message: String(status?.message || ''),
    error: status?.error ? String(status.error) : '',
    sessionId: status?.sessionId ? String(status.sessionId) : '',
    recordingId: status?.recordingId ? String(status.recordingId) : '',
    audioUrl: status?.audioUrl ? String(status.audioUrl) : '',
    transcriptUrl: status?.transcriptUrl ? String(status.transcriptUrl) : '',
    uploadedBytes: Number(status?.uploadedBytes || 0),
    transcriptText: status?.transcriptText ? String(status.transcriptText) : '',
    sources: Array.isArray(status?.sources) ? status.sources : [],
  };
}

function renderCallRecorderStatus(status = state.callRecorder) {
  const current = normalizeCallRecorderStatus(status);
  state.callRecorder = current;
  if (els.callRecorderButton) {
    els.callRecorderButton.classList.toggle('is-recording', current.mode === 'recording');
    els.callRecorderButton.classList.toggle('is-transcribing', current.mode === 'transcribing');
    els.callRecorderButton.classList.toggle('is-error', current.mode === 'error');
    els.callRecorderButton.disabled = current.mode === 'transcribing' || state.mode === 'recording' || state.mode === 'paused' || state.mode === 'transcribing';
    els.callRecorderButton.title = current.mode === 'recording'
      ? 'Stop recording and finalize the live transcript'
      : 'Record microphone and computer audio to server-side history with a live Groq transcript.';
  }
  if (els.callRecorderAction) {
    els.callRecorderAction.textContent = current.mode === 'recording'
      ? 'Stop and finalize'
      : current.mode === 'transcribing'
        ? 'Finalizing...'
        : 'Record computer audio';
  }
  if (els.callRecorderStatus) {
    const hasSystemSource = current.sources.some((source) => String(source?.label || '') === 'system');
    const fallback = hasSystemSource
      ? 'Ready to record microphone and computer audio.'
      : 'Records microphone audio. Configure a system loopback source to include computer audio.';
    els.callRecorderStatus.textContent = current.error || current.message || fallback;
    els.callRecorderStatus.className = `call-recorder-status ${current.mode === 'error' ? 'error' : current.mode === 'saved' ? 'ok' : ''}`.trim();
  }
  if (els.callRecorderOpenButton) {
    els.callRecorderOpenButton.hidden = !current.recordingId;
  }
  if (els.primaryVoiceButton) updateVoiceButtons();
}

async function refreshCallRecorderStatus() {
  if (!desktop.callRecorderStatus) return;
  try {
    renderCallRecorderStatus(await desktop.callRecorderStatus());
  } catch {
    // Local recorder status is optional in non-desktop runtimes.
  }
}

function serverConnectionErrorMessage(serverUrl = readFormConfig().serverUrl) {
  const url = trimSlash(serverUrl) || 'the configured server';
  return `Cannot reach Voice Stream Next server at ${url}. Start the VSN server and try again.`;
}

function voiceStartFailureStatus(error) {
  const message = error?.message ? String(error.message) : String(error || '');
  if (!message.trim()) return 'Voice recording could not start.';
  if (error?.statusCode === 402 || /credits/i.test(message)) return message;
  if (/Cannot reach Voice Stream Next server/i.test(message)) return message;
  return `Voice recording could not start: ${message}`;
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
  if (state.mode !== mode || mode !== 'sleeping') resetSleepPhraseCandidate();
  state.mode = mode;
  if (status) showStatus(status);
  updateVoiceButtons();
  if (desktop.setTrayStatus) {
    void desktop.setTrayStatus({ mode, status: status || els.micStatus.textContent || mode }).catch(() => undefined);
  }
  void reportClientStatus(mode, status || els.micStatus.textContent || mode);
  if (speechPlaybackBlocked()) {
    stopSpeechPlayback({ clearQueue: false, requeueActive: true });
  } else {
    void drainSpeechPlaybackQueue();
  }
  renderCallRecorderStatus();
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
  const data = await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/status`, {
    method: 'POST',
    suppressAuthGuidance: true,
    body: JSON.stringify({
      token: state.config.deviceToken,
      installationId: state.config.installationId || '',
      mode,
      status,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
    }),
  }).catch(() => undefined);
  await rememberReturnedDevice(data?.device);
}

function ensureControlSocket() {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  if (state.controlSocket && state.controlSocket.readyState <= WebSocket.OPEN) return;
  const url = new URL(`/api/devices/${encodeURIComponent(state.config.deviceId)}/control`, trimSlash(state.config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', state.config.deviceToken);
  if (state.config.installationId) url.searchParams.set('installationId', state.config.installationId);
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
    if (message.type === 'control_hello') {
      void rememberReturnedDevice(message.device);
      return;
    }
    if (message.type === 'speech_audio') {
      if (!canQueueSpeechAudio()) return;
      playWavBase64(message.audioBase64);
      return;
    }
    if (message.type === 'settings_changed') {
      handleRemoteSettingsChanged(message);
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

function handleRemoteSettingsChanged(message) {
  const settingsName = String(message?.settings ?? '');
  if (!['assistant_profiles', 'voice_approval', 'voice_codes'].includes(settingsName)) return;
  void reloadVoiceSettingsFromControl(settingsName);
}

async function reloadVoiceSettingsFromControl(settingsName) {
  const settings = await loadVoiceSettings(true).catch((err) => {
    void logDesktopEvent('warn', 'Desktop voice settings reload failed', {
      settings: settingsName,
      error: err?.message || String(err),
    });
    return null;
  });
  if (!settings) return;
  if (state.mode !== 'off') {
    await applyDesktopVoskGrammar(state.mode === 'sleeping' ? 'sleep' : 'awake', settings);
  }
  void logDesktopEvent('info', 'Desktop voice settings reloaded', { settings: settingsName, mode: state.mode });
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
    if (state.voiceSuppressCommands && (state.mode === 'recording' || state.mode === 'paused' || state.mode === 'transcribing')) {
      ack({ ok: false, mode: state.mode, status: els.micStatus.textContent || state.mode, error: 'busy transcribing' });
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
  const callRecorderMode = normalizeCallRecorderStatus(state.callRecorder).mode;
  const callRecorderBusy = callRecorderMode === 'recording' || callRecorderMode === 'transcribing';
  const labels = {
    off: ['Off', 'Start voice'],
    awake: ['Awake', 'Sleep'],
    sleeping: ['Sleeping', 'Wake'],
    recording: ['Recording', 'Stop'],
    paused: ['Paused', 'Resume'],
    transcribing: ['Working', 'Please wait'],
    error: ['Voice error', 'Retry'],
  };
  const [modeLabel, actionLabel] = state.voiceTarget === 'clipboard' && state.mode === 'recording'
    ? ['Recording', 'Transcription']
    : state.voiceTarget === 'clipboard' && state.mode === 'paused'
      ? ['Paused', 'Resume']
    : state.voiceTarget === 'clipboard' && state.mode === 'transcribing'
      ? ['Transcribing', 'Copying']
      : labels[state.mode] || ['Voice', 'Toggle'];
  els.primaryVoiceMode.textContent = modeLabel;
  els.primaryVoiceAction.textContent = actionLabel;
  els.primaryVoiceButton.disabled = state.mode === 'transcribing' || callRecorderBusy;
  els.primaryVoiceButton.className = `voice-orb is-${state.mode}`;
  els.primaryVoiceButton.setAttribute('aria-label', `${actionLabel} desktop voice`);
  els.primaryVoiceButton.setAttribute('aria-pressed', String(streaming || state.mode === 'awake'));
  els.offButton.hidden = state.mode === 'off';
  els.offButton.disabled = state.mode === 'transcribing';
  renderAssistantSpeechPlaybackButton();
}

function assistantSpeechPlaybackEnabled() {
  return state.config?.assistantSpeechPlaybackEnabled !== false;
}

function speechPlaybackBlocked() {
  return state.mode === 'recording' || state.mode === 'transcribing';
}

function renderAssistantSpeechPlaybackButton() {
  const button = els.assistantSpeechPlaybackButton;
  if (!button) return;
  const enabled = assistantSpeechPlaybackEnabled();
  button.textContent = enabled ? 'Speech on' : 'Speech off';
  button.classList.toggle('is-muted', !enabled);
  button.setAttribute('aria-pressed', String(enabled));
  button.title = enabled ? 'Turn off assistant speech playback' : 'Turn on assistant speech playback';
}

async function toggleAssistantSpeechPlayback() {
  const enabled = !assistantSpeechPlaybackEnabled();
  const saved = await desktop.writeConfig(authSessionFields({
    ...readFormConfig(),
    assistantSpeechPlaybackEnabled: enabled,
  }));
  applyConfig(saved);
  if (!enabled) {
    stopSpeechPlayback({ clearQueue: true });
  } else {
    void drainSpeechPlaybackQueue();
  }
  showStatus(enabled ? 'Assistant speech playback enabled.' : 'Assistant speech playback disabled.');
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
  if (state.recordingPaused || state.mode === 'paused') return;
  if (state.voiceOutgoingReady && state.voiceSocket?.readyState === WebSocket.OPEN) {
    flushPendingStreamFrames();
    state.voiceSocket.send(pcmBuffer);
    return;
  }
  if (state.mode === 'recording' || state.voiceStreamStarting) {
    pendingStreamBuffer.push(pcmBuffer);
  }
}

function pushPreRollFrame(pcmBuffer) {
  if (state.mode === 'recording' || state.mode === 'paused' || state.mode === 'off') return;
  preRollBuffer.push(pcmBuffer);
}

function handleWakeAudioFrame(pcmBuffer) {
  if (state.voiceStreamStarting) {
    sendOrBufferStreamFrame(pcmBuffer);
    return;
  }
  if (shouldSuppressWakeCommandsForPlayback()) {
    preRollBuffer.clear();
    return;
  }
  pushPreRollFrame(pcmBuffer);
  if (state.wakeUsesVosk && desktop.sendVoskFrame) {
    desktop.sendVoskFrame(pcmBuffer);
  }
}

function shouldSuppressWakeCommandsForPlayback() {
  return state.config?.suppressWakeDuringPlayback === true &&
    (Boolean(activeSpeechPlayback) || Date.now() < speechPlaybackSuppressWakeUntil);
}

function reconnectDelayLabel(delayMs) {
  return delayMs < 1000 ? `${delayMs}ms` : `${Math.round(delayMs / 1000)}s`;
}

function scheduleVoiceReconnect() {
  if (!['recording', 'paused'].includes(state.mode) || state.voiceStreamEnding || !state.voiceSessionId) return;
  if (state.voiceReconnecting) return;
  state.voiceReconnecting = true;
  const attempt = Math.min(state.voiceReconnectAttempt, MAX_RECONNECT_EXPONENT);
  state.voiceReconnectAttempt += 1;
  const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (2 ** attempt));
  showStatus(`Reconnecting voice stream in ${reconnectDelayLabel(delayMs)}.`);
  state.voiceReconnectTimer = window.setTimeout(() => {
    state.voiceReconnectTimer = null;
    state.voiceReconnecting = false;
    if (!['recording', 'paused'].includes(state.mode) || state.voiceStreamEnding) return;
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
  state.voiceStreamStarting = false;
  state.voicePostStopMode = 'awake';
  state.voicePostStopStatus = '';
  state.recordingPaused = false;
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
  state.recordingPaused = false;
  cancelAnimationFrame(state.meterFrame);
  els.meterBar.style.width = '0%';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function formatLogTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function commandLogLine(log) {
  const parts = [
    `[${log.at || ''}]`,
    String(log.outcome || 'event').toUpperCase(),
    log.mode ? `mode=${log.mode}` : '',
    log.source ? `source=${log.source}` : '',
    log.final ? 'final' : 'partial',
    log.command ? `command=${log.command}` : '',
    log.reason ? `reason=${log.reason}` : '',
    `text=${JSON.stringify(log.text || '')}`,
  ].filter(Boolean);
  return parts.join(' ');
}

function renderCommandLogs() {
  if (!els.commandLogList || !els.commandLogStatus) return;
  const logs = state.commandLogs || [];
  els.commandLogList.textContent = '';
  if (!logs.length) {
    els.commandLogList.innerHTML = '<div class="command-log-empty">No command logs yet.</div>';
    els.commandLogStatus.textContent = 'Matched and unmatched local wake commands will appear here.';
    return;
  }
  for (const log of logs) {
    const row = document.createElement('article');
    row.className = `command-log-row is-${String(log.outcome || 'event').toLowerCase()}`;

    const meta = document.createElement('div');
    meta.className = 'command-log-meta';
    meta.innerHTML = `<span>${escapeHtml(formatLogTime(log.at))}</span><strong>${escapeHtml(log.outcome || 'event')}</strong><span>${escapeHtml(log.mode || '')}</span>`;

    const text = document.createElement('div');
    text.className = 'command-log-text';
    text.textContent = log.text ? `"${log.text}"` : '(empty)';

    const detail = document.createElement('div');
    detail.className = 'command-log-detail';
    detail.textContent = [
      log.command ? `command ${log.command}` : '',
      log.reason || '',
      log.source ? `${log.source}${log.final ? ' final' : ' partial'}` : '',
    ].filter(Boolean).join(' · ');

    row.append(meta, text, detail);
    els.commandLogList.append(row);
  }
  els.commandLogStatus.textContent = `Showing ${logs.length} local command log${logs.length === 1 ? '' : 's'}.`;
}

async function loadCommandLogs() {
  if (!desktop.readCommandLogs) return;
  const result = await desktop.readCommandLogs();
  state.commandLogs = Array.isArray(result?.logs) ? result.logs : [];
  renderCommandLogs();
}

async function clearCommandLogs() {
  if (!desktop.clearCommandLogs) return;
  const result = await desktop.clearCommandLogs();
  state.commandLogs = Array.isArray(result?.logs) ? result.logs : [];
  renderCommandLogs();
  showStatus('Cleared local command logs.');
}

async function copyCommandLogs() {
  const text = (state.commandLogs || []).map(commandLogLine).join('\n');
  if (!text) {
    showStatus('No local command logs to copy.');
    return;
  }
  await desktop.writeClipboard(text);
  showStatus('Copied local command logs.');
}

function isLogsSettingsActive() {
  return Boolean(els.logsSettingsTab?.classList.contains('is-active'));
}

async function recordCommandRecognitionLog(entry) {
  const payload = {
    at: new Date().toISOString(),
    mode: state.mode,
    source: state.wakeUsesVosk ? 'vosk' : 'speech-recognition',
    ...entry,
  };
  if (!desktop.appendCommandLog) return;
  try {
    const result = await desktop.appendCommandLog(payload);
    state.commandLogs = Array.isArray(result?.logs) ? result.logs : [payload, ...state.commandLogs].slice(0, 200);
    if (isLogsSettingsActive()) renderCommandLogs();
  } catch {
    // Local command diagnostics must not affect wake handling.
  }
}

async function loadDashboard() {
  updateConnection('pending', 'Connecting', 'Loading dashboard');
  try {
    if (state.config?.deviceId && state.config?.deviceToken) {
      const data = await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/bootstrap`, {
        suppressAuthGuidance: true,
        headers: {
          'x-voice-device-token': state.config.deviceToken,
          'x-voice-installation-id': state.config.installationId || '',
          'x-voice-client-version': '1',
        },
      });
      if (data.device?.id && data.device.id !== state.config.deviceId) {
        applyConfig(await desktop.writeConfig({
          ...state.config,
          deviceId: data.device.id,
          deviceName: data.device.displayName || state.config.deviceName,
        }));
      }
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
      await syncAssistantRecordingShortcutsWithProfiles();
      renderShortcutSettings();
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
    await syncAssistantRecordingShortcutsWithProfiles();
    renderShortcutSettings();
    updateConnection('ok', 'Connected', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : `${dashboard.user.displayName}`);
    showPairingMessage(state.config.deviceId ? 'Desktop connected.' : `Signed in as ${dashboard.user.displayName}. Connect this desktop before recording.`);
  } catch (err) {
    if (state.config?.deviceId && staleDeviceError(err)) {
      await clearSavedDevice(`Saved desktop pairing is stale (${err.reason || err.message}). Sign in again.`);
    }
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

async function loadVoiceSettings(forceReload = false) {
  if (!forceReload && state.voiceSettings) return state.voiceSettings;
  let settings;
  try {
    if (state.config?.deviceId && state.config?.deviceToken) {
      const data = await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/bootstrap`, {
        suppressAuthGuidance: true,
        headers: {
          'x-voice-device-token': state.config.deviceToken,
          'x-voice-installation-id': state.config.installationId || '',
          'x-voice-client-version': '1',
        },
      });
      if (data.device?.id && data.device.id !== state.config.deviceId) {
        applyConfig(await desktop.writeConfig({
          ...state.config,
          deviceId: data.device.id,
          deviceName: data.device.displayName || state.config.deviceName,
        }));
      }
      settings = data.settings;
    } else {
      const data = await api('/api/settings/voice-approval');
      settings = data.settings;
    }
  } catch (err) {
    if (state.config?.deviceId && staleDeviceError(err)) {
      await clearSavedDevice(`Saved desktop pairing is stale (${err.reason || err.message}). Sign in again.`);
    }
    throw err;
  }
  state.voiceSettings = settings;
  state.approvalRecognizer.configure({
    triggerPhrase: settings.triggerPhrase,
    minDigits: settings.minDigits,
    maxDigits: settings.maxDigits,
    stableMs: settings.stableMs,
    collectTimeoutMs: settings.collectTimeoutMs,
    duplicateCooldownMs: settings.duplicateCooldownMs,
    finalizeCheckIntervalMs: settings.finalizeCheckIntervalMs,
  });
  await syncAssistantRecordingShortcutsWithProfiles();
  renderShortcutSettings();
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
  await startDesktopAuthRequest({ openBrowser: true });
}

function setDesktopAuthQrStatus(message, kind = 'muted') {
  if (!els.desktopAuthQrStatus) return;
  els.desktopAuthQrStatus.textContent = message;
  els.desktopAuthQrStatus.className = kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : '';
}

function clearDesktopAuthQr(message = 'Use browser sign-in or refresh the QR.') {
  if (els.desktopAuthQrImage) {
    els.desktopAuthQrImage.hidden = true;
    els.desktopAuthQrImage.removeAttribute('src');
  }
  if (els.desktopAuthQrPlaceholder) {
    els.desktopAuthQrPlaceholder.hidden = false;
  }
  setDesktopAuthQrStatus(message, 'muted');
}

async function renderDesktopAuthQrPayload(payload, statusMessage) {
  if (!desktop.qrDataUrl || !els.desktopAuthQrImage) return;
  const dataUrl = await desktop.qrDataUrl(payload);
  els.desktopAuthQrImage.src = dataUrl;
  els.desktopAuthQrImage.hidden = false;
  if (els.desktopAuthQrPlaceholder) els.desktopAuthQrPlaceholder.hidden = true;
  setDesktopAuthQrStatus(statusMessage || 'Scan this with the signed-in Android app.', 'ok');
}

async function startLocalDesktopAuthQr() {
  clearDesktopAuthPoll();
  const saved = await desktop.writeConfig(authSessionFields(readFormConfig()));
  applyConfig(saved);
  if (!desktop.desktopAuthQrPayload) throw new Error('Desktop QR sign-in is not available in this build.');
  const result = await desktop.desktopAuthQrPayload({
    displayName: saved.deviceName,
    installationId: saved.installationId,
  });
  await renderDesktopAuthQrPayload(result.payload, 'Scan this with the signed-in Android app.');
  updateAuthStatus('idle', 'Scan the QR from the signed-in Android app to connect this desktop.');
}

async function startDesktopAuthRequest({ openBrowser = false } = {}) {
  clearDesktopAuthPoll();
  if (openBrowser && desktop.stopDesktopAuthQr) {
    await desktop.stopDesktopAuthQr().catch(() => undefined);
    clearDesktopAuthQr('QR sign-in paused while browser sign-in is active.');
  }
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
  const auth = {
    requestId: data.requestId,
    secret: data.secret,
    deviceToken: data.deviceToken,
    expiresAt: data.expiresAt,
    minClientVersion: data.minClientVersion,
  };
  if (openBrowser) {
    const authUrl = new URL(authBaseUrl);
    authUrl.searchParams.set('desktopAuthRequest', data.requestId);
    authUrl.searchParams.set('desktopAuthSecret', data.secret);
    authUrl.searchParams.set('desktopName', saved.deviceName);
    void desktop.openExternal(authUrl.toString());
    updateAuthStatus('idle', 'Opened browser sign in. This desktop will connect automatically after login.');
  } else {
    updateAuthStatus('idle', 'Scan the QR from the signed-in Android app to connect this desktop.');
  }
  startDesktopAuthPoll(auth);
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
        const claimedServerUrl = data.serverUrl ? trimSlash(data.serverUrl) : trimSlash(current.serverUrl);
        const paired = await desktop.writeConfig({
          ...current,
          serverUrl: claimedServerUrl,
          deviceId: data.device.id,
          deviceToken: auth.deviceToken,
          deviceName: data.device.displayName || current.deviceName,
        });
        applyConfig(paired);
        void desktop.expandWindow?.().then(applyWindowState);
        ensureControlSocket();
        const switchedServers = claimedServerUrl && claimedServerUrl !== trimSlash(current.serverUrl);
        updateAuthStatus('ok', switchedServers ? `Desktop connected to ${claimedServerUrl}.` : 'Desktop connected through sign in.');
        showPairingMessage(switchedServers ? `Desktop connected to ${claimedServerUrl}.` : 'Desktop connected through sign in.');
        showStatus('Desktop connected.');
        await loadDashboard().catch((err) => showStatus(err.message));
        return;
      }
      updateAuthStatus('idle', 'Waiting for QR scan or browser sign in to finish.');
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
  if (desktop.stopDesktopAuthQr) await desktop.stopDesktopAuthQr().catch(() => undefined);
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

function selectSettingsTab(tab) {
  const tabs = [
    { id: 'audio', tabEl: els.audioSettingsTab, panelEl: els.audioSettingsPanel },
    { id: 'shortcuts', tabEl: els.shortcutsSettingsTab, panelEl: els.shortcutsSettingsPanel },
    { id: 'logs', tabEl: els.logsSettingsTab, panelEl: els.logsSettingsPanel },
  ];
  for (const item of tabs) {
    const active = item.id === tab;
    item.tabEl?.classList.toggle('is-active', active);
    item.tabEl?.setAttribute('aria-selected', String(active));
    if (item.panelEl) {
      item.panelEl.hidden = !active;
      item.panelEl.classList.toggle('is-active', active);
    }
  }
  closeDeviceMenus();
}

function toggleSettingsPanel() {
  if (!els.settingsPanel || !els.settingsButton) return;
  const willOpen = els.settingsPanel.hidden;
  els.settingsPanel.hidden = !willOpen;
  els.settingsButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    if (els.audioSettingsTab?.classList.contains('is-active')) {
      void refreshAudioDevicePickers();
    }
    if (isLogsSettingsActive()) {
      void loadCommandLogs().catch(() => undefined);
    }
    if (desktop.shortcutStatus) {
      void desktop.shortcutStatus().then((status) => {
        state.shortcutStatus = normalizeShortcutStatusPayload(status);
        renderShortcutSettings();
      }).catch(() => undefined);
    }
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

async function createVoiceSession(target, assistantProfileId = null) {
  await ensureRecordingDevice();
  const body = {
    deviceId: state.config.deviceId,
    token: state.config.deviceToken,
    installationId: state.config.installationId || '',
    mode: target,
    protocolVersion: 1,
  };
  if (assistantProfileId) body.assistantProfileId = assistantProfileId;
  try {
    const data = await api('/api/voice/sessions', {
      method: 'POST',
      suppressAuthGuidance: true,
      body: JSON.stringify(body),
    });
    if (data.device?.id && data.device.id !== state.config.deviceId) {
      applyConfig(await desktop.writeConfig({
        ...state.config,
        deviceId: data.device.id,
        deviceName: data.device.displayName || state.config.deviceName,
      }));
    }
    return data;
  } catch (err) {
    if (!staleDeviceError(err)) throw err;
    await clearSavedDevice(`Saved desktop pairing is stale (${err.reason || err.message}). Sign in again.`);
    throw new Error('Sign in before starting voice.');
  }
}

async function startMic(target = 'assistant', options = {}) {
  const previousMode = state.mode;
  state.voiceTarget = cleanVoiceTarget(target);
  state.voiceAssistantProfileId = options.assistantProfileId || null;
  state.voiceSuppressCommands = options.ignoreCommands === true;
  resetVoiceStreamState();
  pendingStreamBuffer.pushAll(preRollBuffer.drain());
  state.voiceStreamStarting = true;
  try {
    const session = await createVoiceSession(target, state.voiceAssistantProfileId);
    state.voiceSessionId = session.session.id;
    if (options.cue) playLocalVoiceCue(options.cue);
    const reusedWakeCapture = adoptWakeAudioCaptureForRecording();
    if (!reusedWakeCapture) {
      stopWakeListener();
      state.stream = await getMicrophoneStream();
      const context = new AudioContext({ sampleRate: 16000 });
      state.audioContext = context;
      const source = context.createMediaStreamSource(state.stream);
      state.analyser = context.createAnalyser();
      state.analyser.fftSize = 256;
      state.processor = context.createScriptProcessor(4096, 1, 1);
      source.connect(state.analyser);
      source.connect(state.processor);
      state.processor.connect(context.destination);
    }
    state.voiceSocket = openVoiceSocket(state.voiceTarget);
    state.processor.onaudioprocess = (event) => {
      sendOrBufferStreamFrame(floatToPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate));
    };
    setMode('recording', recordingStatus(state.voiceTarget));
    state.voiceStreamStarting = false;
    await api('/api/logs', {
      method: 'POST',
      suppressAuthGuidance: true,
      body: JSON.stringify({
        deviceId: state.config.deviceId,
        token: state.config.deviceToken,
        installationId: state.config.installationId || '',
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
    state.voiceAssistantProfileId = null;
    state.voiceSuppressCommands = false;
    state.recordingPaused = false;
    state.voiceStreamStarting = false;
    resetVoiceStreamState();
    const status = voiceStartFailureStatus(err);
    const returnMode = previousMode === 'off' || previousMode === 'sleeping' ? previousMode : 'awake';
    setMode(returnMode, status);
    if (previousMode !== 'off') startWakeListener();
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
    suppressAuthGuidance: true,
    body: JSON.stringify({
      deviceId: state.config.deviceId,
      token: state.config.deviceToken,
      installationId: state.config.installationId || '',
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
  if (state.config.installationId) url.searchParams.set('installationId', state.config.installationId);
  if (state.voiceSessionId) url.searchParams.set('sessionId', state.voiceSessionId);
  if (state.voiceAssistantProfileId) url.searchParams.set('assistantProfileId', state.voiceAssistantProfileId);
  if (state.voiceSuppressCommands) url.searchParams.set('ignoreCommands', '1');
  url.searchParams.set('mode', target);
  const socket = new WebSocket(url.toString());
  let terminalMessageReceived = false;
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    state.voiceReconnectAttempt = 0;
    state.voiceOutgoingReady = true;
    socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-fallback', mode: target }));
    flushPendingStreamFrames();
    showStatus(state.recordingPaused ? pausedStatus(target) : recordingStatus(target));
  };
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') {
      playWav(event.data);
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'server_hello') {
        if (state.recordingPaused || state.mode === 'paused') {
          sendVoiceStreamControl('pause', 'desktop reconnect');
        }
      }
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      }
      if (message.type === 'assistant_result') {
        terminalMessageReceived = true;
        showStatus(`Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`);
        const returnTarget = voiceResultReturnTarget('awake', els.micStatus.textContent || state.voicePostStopStatus);
        state.voicePostStopStatus = returnTarget.status;
        state.voicePostStopMode = returnTarget.mode;
        await finishMicFromServer();
      }
      if (message.type === 'transcript_result') {
        terminalMessageReceived = true;
        showStatus(message.status || 'Transcript patched into chat.');
        const returnTarget = voiceResultReturnTarget('awake', els.micStatus.textContent || state.voicePostStopStatus);
        state.voicePostStopStatus = returnTarget.status;
        state.voicePostStopMode = returnTarget.mode;
        await finishMicFromServer();
      }
      if (message.type === 'terminal_detected') {
        await handleTerminalDetected(message, socket, target);
      }
      if (message.type === 'finish') {
        terminalMessageReceived = true;
        if (target === 'clipboard') {
          const transcriptText = message.transcriptText || '';
          const copied = await copyText(transcriptText);
          void logDesktopEvent(copied ? 'info' : 'warn', copied ? 'Clipboard transcription copied' : 'Clipboard transcription copy failed', {
            chars: String(transcriptText || '').trim().length,
          });
          if (copied) playLocalVoiceCue('clipboard_transcription_success');
          showStatus(copied ? 'Copied voice transcription.' : 'No voice transcription detected.');
        } else {
          showStatus('Awake. Waiting for voice command.');
        }
        const returnTarget = voiceResultReturnTarget('awake', els.micStatus.textContent || state.voicePostStopStatus);
        state.voicePostStopStatus = returnTarget.status;
        state.voicePostStopMode = returnTarget.mode;
        await finishMicFromServer();
      }
      if (message.type === 'sleep') {
        terminalMessageReceived = true;
        if (target === 'clipboard' && message.transcriptText) {
          const transcriptText = message.transcriptText || '';
          const copied = await copyText(transcriptText);
          void logDesktopEvent(copied ? 'info' : 'warn', copied ? 'Clipboard transcription copied before sleep' : 'Clipboard transcription copy before sleep failed', {
            chars: String(transcriptText || '').trim().length,
          });
        }
        const settings = await loadVoiceSettings().catch(() => null);
        const status = 'Sleeping. Say your unlock or shutdown phrase.';
        if (state.mode !== 'sleeping') {
          playLocalVoiceCue('sleep');
        }
        state.voicePostStopStatus = status;
        state.voicePostStopMode = 'sleeping';
        await finishMicFromServer();
      }
      if (message.type === 'assistant_error') {
        terminalMessageReceived = true;
        showStatus(message.error || 'Voice runtime failed.');
        const returnTarget = voiceResultReturnTarget('awake', els.micStatus.textContent || state.voicePostStopStatus);
        state.voicePostStopStatus = returnTarget.status;
        state.voicePostStopMode = returnTarget.mode;
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
    if (['recording', 'paused'].includes(state.mode) && !state.voiceStreamEnding && event.code === 1000) {
      if (target === 'clipboard' && !terminalMessageReceived) {
        void logDesktopEvent('warn', 'Voice stream closed before clipboard result', { code: event.code, reason: event.reason || '' });
      }
      void finishMicFromServer();
      return;
    }
    if (['recording', 'paused'].includes(state.mode) && !state.voiceStreamEnding) {
      showStatus(serverConnectionErrorMessage());
      scheduleVoiceReconnect();
      return;
    }
    if (!state.voiceStreamEnding) {
      showStatus('Voice stream closed.');
    }
  };
  socket.onerror = () => {
    state.voiceOutgoingReady = false;
    if (['recording', 'paused'].includes(state.mode) && !state.voiceStreamEnding) {
      showStatus(serverConnectionErrorMessage());
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
  const commandType = String(message.commandType || '');
  let status = commandType === 'abort'
    ? 'Awake. Voice command cancelled.'
    : commandType === 'sleep'
      ? 'Going to sleep.'
      : target === 'clipboard'
        ? 'Awake. Finishing clipboard transcription.'
        : 'Awake. Finishing voice request.';
  if (commandType === 'sleep') {
    status = 'Sleeping. Say your unlock or shutdown phrase.';
    resetApprovalCollection();
    playLocalVoiceCue('sleep');
  } else {
    playLocalVoiceCue('stop_button');
  }
  const returnTarget = commandType === 'sleep'
    ? { mode: 'sleeping', status }
    : voiceResultReturnTarget('awake', status);
  state.voicePostStopMode = returnTarget.mode;
  state.voicePostStopStatus = returnTarget.status;
  if (commandType === 'sleep') {
    await enterStoppedSleep(returnTarget.status);
  } else {
    setMode(returnTarget.mode, returnTarget.status);
  }
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
  state.voiceAssistantProfileId = null;
  state.voiceSuppressCommands = false;
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
    finishTranscriptionShortcutOverlay();
    return;
  }
  if (nextMode === 'sleeping') {
    void enterStoppedSleep(status || 'Sleeping.');
    finishTranscriptionShortcutOverlay();
    return;
  }
  setMode('awake', status || 'Awake. Waiting for voice command.');
  startWakeListener();
  finishTranscriptionShortcutOverlay();
}

async function enterStoppedSleep(status = 'Sleeping.') {
  resetApprovalCollection();
  setMode('sleeping', status || 'Sleeping.');
  const settings = await loadVoiceSettings(true).catch((err) => {
    showStatus(err?.message || 'Could not load voice settings.');
    return null;
  });
  await applyDesktopVoskGrammar('sleep', settings);
  startWakeListener();
}

function voiceResultReturnTarget(defaultMode = 'awake', defaultStatus = '') {
  if (state.transcriptionShortcutActive && state.voiceTarget === 'clipboard') {
    return { mode: transcriptionReturnMode(), status: transcriptionReturnStatus() };
  }
  return { mode: defaultMode, status: defaultStatus };
}

function beginTranscriptionShortcutSession(overlayRestore) {
  state.transcriptionShortcutActive = true;
  state.transcriptionReturnMode = ['off', 'awake', 'sleeping'].includes(state.mode) ? state.mode : 'awake';
  state.transcriptionReturnStatus = els.micStatus.textContent || '';
  state.transcriptionOverlayRestore = overlayRestore?.temporaryOverlay
    ? { restoreWindowMode: overlayRestore.restoreWindowMode || 'hidden' }
    : null;
}

function transcriptionReturnMode() {
  return state.transcriptionReturnMode === 'off' || state.transcriptionReturnMode === 'sleeping' || state.transcriptionReturnMode === 'awake'
    ? state.transcriptionReturnMode
    : 'awake';
}

function transcriptionReturnStatus() {
  const mode = transcriptionReturnMode();
  if (mode === 'off') return 'Off.';
  if (state.transcriptionReturnStatus) return state.transcriptionReturnStatus;
  if (mode === 'sleeping') return 'Sleeping.';
  return 'Awake. Waiting for voice command.';
}

function finishTranscriptionShortcutOverlay() {
  if (!state.transcriptionShortcutActive) return;
  const overlayRestore = state.transcriptionOverlayRestore;
  state.transcriptionShortcutActive = false;
  state.transcriptionReturnMode = null;
  state.transcriptionReturnStatus = '';
  state.transcriptionOverlayRestore = null;
  restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
}

function restoreTemporaryTranscriptionOverlay(overlayRestore, delayMs = 0) {
  if (!overlayRestore?.temporaryOverlay || !desktop.restoreTemporaryOverlay) return;
  const restorePayload = { restoreWindowMode: overlayRestore.restoreWindowMode || 'hidden' };
  const restore = () => {
    void desktop.restoreTemporaryOverlay(restorePayload).then(applyWindowState).catch(() => undefined);
  };
  if (delayMs > 0) {
    window.setTimeout(restore, delayMs);
    return;
  }
  restore();
}

async function prepareFocusedWindowTranscriptionOverlay() {
  if (state.compact || !desktop.compactWindow) return null;
  await desktop.compactWindow().then(applyWindowState).catch(() => undefined);
  return { temporaryOverlay: true, restoreWindowMode: 'expanded' };
}

function floatToPcm16(input, sourceSampleRate = VOICE_PCM_SAMPLE_RATE_HZ) {
  const samples = resampleFloat32(input, sourceSampleRate, VOICE_PCM_SAMPLE_RATE_HZ);
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function resampleFloat32(input, sourceSampleRate, targetSampleRate) {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0 || Math.abs(sourceSampleRate - targetSampleRate) < 1) {
    return input;
  }
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const sourceIndex = Math.floor(sourcePosition);
    const nextIndex = Math.min(input.length - 1, sourceIndex + 1);
    const fraction = sourcePosition - sourceIndex;
    output[index] = input[sourceIndex] * (1 - fraction) + input[nextIndex] * fraction;
  }
  return output;
}

function cleanVoiceTarget(target) {
  return target === 'patch' || target === 'clipboard' ? target : 'assistant';
}

function recordingStatus(target) {
  if (target === 'patch') return 'Patching voice transcript into chat.';
  if (target === 'clipboard') return 'Recording clipboard transcription.';
  return 'Streaming microphone frames to the Drone service.';
}

function pausedStatus(target = state.voiceTarget) {
  if (target === 'clipboard') return 'Clipboard transcription paused.';
  if (target === 'patch') return 'Voice patch recording paused.';
  return 'Voice request recording paused.';
}

function resumeStatus(target = state.voiceTarget) {
  return recordingStatus(target);
}

function sendVoiceStreamControl(type, reason = 'desktop shortcut') {
  const socket = state.voiceSocket;
  if (!socket || (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)) return;
  const send = () => {
    try {
      socket.send(JSON.stringify({ type, reason }));
    } catch {
      // The stream may close while a pause/resume shortcut is being handled.
    }
  };
  if (socket.readyState === WebSocket.OPEN) {
    send();
    return;
  }
  socket.addEventListener('open', send, { once: true });
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
let activeSpeechPlayback = null;
let lastCompletedSpeechPlaybackData = null;
let speechPlaybackSuppressWakeUntil = 0;

function canPlaySpeechAudio() {
  return canQueueSpeechAudio() && !speechPlaybackBlocked();
}

function canQueueSpeechAudio() {
  return assistantSpeechPlaybackEnabled();
}

function playWav(data) {
  if (!canQueueSpeechAudio()) return;
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
      if (speechPlaybackBlocked()) break;
      if (!canPlaySpeechAudio()) {
        speechPlaybackQueue.length = 0;
        break;
      }
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
  let completed = false;
  try {
    if (outputDeviceId && typeof audio.setSinkId === 'function') {
      await audio.setSinkId(outputDeviceId);
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (activeSpeechPlayback?.audio === audio) activeSpeechPlayback = null;
        resolve();
      };
      activeSpeechPlayback = { audio, finish, data };
      audio.addEventListener('ended', () => {
        completed = true;
        finish();
      }, { once: true });
      audio.addEventListener('error', finish, { once: true });
      audio.play().catch(finish);
    });
  } catch (err) {
    showStatus(err?.message ? `Audio playback failed: ${err.message}` : 'Audio playback failed.');
  } finally {
    if (activeSpeechPlayback?.audio === audio) activeSpeechPlayback = null;
    if (state.config?.suppressWakeDuringPlayback === true) {
      speechPlaybackSuppressWakeUntil = Date.now() + 800;
    }
    if (completed) lastCompletedSpeechPlaybackData = data;
    URL.revokeObjectURL(url);
  }
}

function stopSpeechPlayback(options = {}) {
  if (options.clearQueue) speechPlaybackQueue.length = 0;
  const active = activeSpeechPlayback;
  if (!active) return false;
  activeSpeechPlayback = null;
  if (options.requeueActive && active.data) {
    speechPlaybackQueue.unshift(active.data);
  }
  try {
    active.audio.pause();
    active.audio.currentTime = 0;
  } catch {
    // Ignore stop races with already-finished audio.
  }
  active.finish();
  return true;
}

function repeatLastSpeechPlayback() {
  if (!assistantSpeechPlaybackEnabled()) return false;
  if (!lastCompletedSpeechPlaybackData) return false;
  stopSpeechPlayback({ clearQueue: false });
  speechPlaybackQueue.unshift(lastCompletedSpeechPlaybackData);
  void drainSpeechPlaybackQueue();
  return true;
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
  const nextStatus = partialCode ? `Approval: ${partialCode}` : 'Approval code...';
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

function phraseWords(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchesWakePhrase(text, phrase) {
  if (globalThis.VoicePhrases?.matchesPhrase) {
    return globalThis.VoicePhrases.matchesPhrase(text, phrase);
  }
  const words = phraseWords(text);
  const phraseWordsList = phraseWords(phrase);
  if (phraseWordsList.length === 0) return false;
  return words.some((word, index) => phraseWordsList.every((phraseWord, offset) => words[index + offset] === phraseWord));
}

function wakePhraseMatch(text, assistantProfiles = []) {
  const words = phraseWords(text);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return { command: 'sleep' };
  if (words.some((word, index) => (word === 'ok' || word === 'okay') && words[index + 1] === 'stop')) return { command: 'stop_audio' };
  if (words.some((word, index) => word === 'repeat' && words[index + 1] === 'what' && words[index + 2] === 'you' && words[index + 3] === 'said')) return { command: 'repeat_audio' };
  for (const profile of assistantProfiles.filter((profile) => profile?.enabled !== false)) {
    const phrases = [profile?.wakePhrase, ...(Array.isArray(profile?.wakePhraseAliases) ? profile.wakePhraseAliases : [])];
    if (phrases.some((phrase) => matchesWakePhrase(text, phrase || ''))) return { command: 'start', assistantProfileId: profile.id || null };
  }
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return { command: 'patch' };
  if (words.some((word, index) => word === 'can' && words[index + 1] === 'you' && words[index + 2] === 'transcribe')) return { command: 'clipboard' };
  if (ENABLE_STATUS_WAKE_COMMAND && (words.includes('status') || compact === 'stateus' || compact === 'checkstatus')) return { command: 'status' };
  return null;
}

function resetSleepPhraseCandidate() {
  if (state.sleepPhraseTimer) {
    window.clearTimeout(state.sleepPhraseTimer);
    state.sleepPhraseTimer = null;
  }
  state.sleepPhraseCandidate = null;
}

function sleepPhraseWords(phrase) {
  return globalThis.VoicePhrases.phraseWords(phrase);
}

function classifySleepPhraseText(text, settings) {
  if (!settings || !globalThis.VoicePhrases) return null;
  const words = globalThis.VoicePhrases.wordsFromText(text);
  const candidates = [
    { match: 'unlock', target: sleepPhraseWords(settings.unlockPhrase) },
    { match: 'shutdown', target: sleepPhraseWords(settings.shutdownPhrase) },
  ];
  for (const candidate of candidates) {
    if (candidate.target.length === 0 || words.length === 0 || words.length > candidate.target.length) continue;
    const prefix = words.every((word, index) => word === candidate.target[index]);
    if (!prefix) continue;
    return { match: candidate.match, complete: words.length === candidate.target.length };
  }
  return null;
}

function scheduleSleepPhraseCompletion(match, text, finalResult) {
  if (state.sleepPhraseTimer) window.clearTimeout(state.sleepPhraseTimer);
  state.sleepPhraseTimer = window.setTimeout(() => {
    const candidate = state.sleepPhraseCandidate;
    if (!candidate || candidate.match !== match || !candidate.complete || state.mode !== 'sleeping') return;
    resetSleepPhraseCandidate();
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'matched', command: match, reason: 'stable partial' });
    void applySleepPhraseMatch(match).catch((err) => showStatus(err?.message || 'Could not apply sleep command.'));
  }, SLEEP_PHRASE_STABLE_MS);
}

function stableSleepPhraseMatch(text, settings, finalResult = false) {
  if (!settings || !globalThis.VoicePhrases) {
    resetSleepPhraseCandidate();
    return { status: 'none', match: null };
  }
  const phrase = classifySleepPhraseText(text, settings);
  if (!phrase) {
    resetSleepPhraseCandidate();
    return { status: 'none', match: null };
  }
  if (finalResult && phrase.complete) {
    resetSleepPhraseCandidate();
    return { status: 'matched', match: phrase.match };
  }
  const now = Date.now();
  const candidate = state.sleepPhraseCandidate;
  if (!candidate || candidate.match !== phrase.match || now - candidate.lastSeenAt > SLEEP_PHRASE_MAX_GAP_MS) {
    state.sleepPhraseCandidate = { match: phrase.match, firstSeenAt: now, lastSeenAt: now, hits: phrase.complete ? 1 : 0, complete: phrase.complete };
    if (phrase.complete) scheduleSleepPhraseCompletion(phrase.match, text, finalResult);
    return { status: 'pending', match: phrase.match, complete: phrase.complete };
  }
  if (phrase.complete) candidate.hits += 1;
  candidate.complete = candidate.complete || phrase.complete;
  candidate.lastSeenAt = now;
  if (candidate.complete) scheduleSleepPhraseCompletion(phrase.match, text, finalResult);
  if (candidate.complete && candidate.hits >= SLEEP_PHRASE_MIN_HITS && now - candidate.firstSeenAt >= SLEEP_PHRASE_STABLE_MS) {
    resetSleepPhraseCandidate();
    return { status: 'matched', match: phrase.match };
  }
  return { status: 'pending', match: phrase.match, complete: phrase.complete };
}

async function logDesktopEvent(level, message, details) {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  await api('/api/logs', {
    method: 'POST',
    suppressAuthGuidance: true,
    body: JSON.stringify({
      deviceId: state.config.deviceId,
      token: state.config.deviceToken,
      installationId: state.config.installationId || '',
      source: 'desktop',
      level,
      message,
      details,
      protocolVersion: 1,
    }),
  }).catch(() => {});
}

async function applyDesktopVoskGrammar(mode, settings) {
  if (!settings || !desktop.setVoskGrammar) return;
  await desktop.setVoskGrammar(mode, settings).catch(() => null);
}

async function enterAwake() {
  resetApprovalCollection();
  const settings = await loadVoiceSettings(true).catch((err) => {
    showStatus(err?.message || 'Could not load voice settings.');
    return null;
  });
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  setMode('awake', 'Awake. Say your assistant wake phrase to start recording.');
  await applyDesktopVoskGrammar('awake', settings);
  startWakeListener();
}

async function enterSleep() {
  if (state.mode === 'sleeping' && !state.voiceSocket && !state.stream) {
    return;
  }
  if (state.voiceSocket || state.stream) {
    await stopMic('sleeping', { cue: null, finalStatus: 'Sleeping.' });
    return;
  }
  resetApprovalCollection();
  playLocalVoiceCue('sleep');
  const settings = await loadVoiceSettings(true).catch((err) => {
    showStatus(err?.message || 'Could not load voice settings.');
    return null;
  });
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  setMode('sleeping', 'Sleeping. Say your unlock or shutdown phrase.');
  await applyDesktopVoskGrammar('sleep', settings);
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

function pauseRecording() {
  if (state.mode !== 'recording' || (!state.voiceSocket && !state.stream)) {
    showStatus('No active recording to pause.');
    return false;
  }
  state.recordingPaused = true;
  pendingStreamBuffer.clear();
  sendVoiceStreamControl('pause');
  els.meterBar.style.width = '0%';
  playLocalVoiceCue('recording_pause');
  setMode('paused', pausedStatus(state.voiceTarget));
  void logDesktopEvent('info', 'Desktop microphone capture paused', { target: state.voiceTarget });
  return true;
}

function resumeRecording() {
  if (state.mode !== 'paused' || (!state.voiceSocket && !state.stream)) {
    showStatus('No paused recording to resume.');
    return false;
  }
  state.recordingPaused = false;
  pendingStreamBuffer.clear();
  sendVoiceStreamControl('resume');
  playLocalVoiceCue('recording_resume');
  setMode('recording', resumeStatus(state.voiceTarget));
  void logDesktopEvent('info', 'Desktop microphone capture resumed', { target: state.voiceTarget });
  return true;
}

async function togglePauseResumeRecording() {
  if (state.mode === 'recording') {
    pauseRecording();
    return;
  }
  if (state.mode === 'paused') {
    resumeRecording();
    return;
  }
  if (state.mode === 'transcribing') {
    showStatus('Voice transcription is finishing.');
    return;
  }
  showStatus('No active recording to pause.');
}

function assistantRecordingShortcutFromEvent(event) {
  for (const shortcut of sanitizeAssistantRecordingShortcuts(state.config?.assistantRecordingShortcuts)) {
    if (isShortcutMatch(shortcut.binding, event)) return shortcut;
  }
  return null;
}

async function startAssistantRecordingShortcut(payload = {}) {
  if (!state.config?.deviceId || !state.config?.deviceToken) {
    showStatus('Connect this desktop before recording with an assistant shortcut.');
    return;
  }
  if (state.voiceStreamStarting) {
    showStatus('Assistant voice recording is already starting.');
    return;
  }
  if (state.mode === 'transcribing') {
    showStatus('Voice transcription is already running.');
    return;
  }
  if (state.mode === 'recording' || state.mode === 'paused') {
    showStatus('Stop the current recording before starting another assistant recording.');
    return;
  }

  const assistantProfileId = String(payload?.assistantProfileId || '').trim() || null;
  const settings = await loadVoiceSettings().catch((err) => {
    showStatus(err?.message || 'Could not load assistant profiles.');
    return null;
  });
  if (!settings) return;
  if (assistantProfileId) {
    const profile = enabledAssistantProfiles().find((entry) => String(entry?.id || '') === assistantProfileId);
    if (!profile) {
      showStatus('That assistant profile is unavailable or disabled.');
      return;
    }
  }

  await startMic('assistant', { cue: 'wake', assistantProfileId });
}

async function toggleCallRecorder() {
  const current = normalizeCallRecorderStatus(state.callRecorder);
  if (current.mode === 'transcribing') {
    showStatus('Computer audio transcription is already running.');
    return;
  }
  if (!state.config?.deviceId || !state.config?.deviceToken) {
    showStatus('Connect this desktop before recording computer audio.');
    return;
  }
  if (state.mode === 'recording' || state.mode === 'paused' || state.mode === 'transcribing') {
    showStatus('Stop the current voice recording before starting computer audio recording.');
    return;
  }
  if (current.mode === 'recording') {
    renderCallRecorderStatus({ ...current, mode: 'transcribing', message: 'Stopping recording and finalizing the live transcript.' });
    const status = await desktop.stopCallRecorder();
    renderCallRecorderStatus(status);
    if (status?.mode === 'saved') {
      showStatus('Computer audio recording saved with transcript.');
    } else if (status?.mode === 'error') {
      showStatus(status.error || status.message || 'Computer audio recording failed.');
    }
    return;
  }
  const status = await desktop.startCallRecorder();
  renderCallRecorderStatus(status);
  showStatus(status?.message || 'Recording computer audio.');
}

async function processApprovalCode(code) {
  const settings = await loadVoiceSettings();
  if (state.mode === 'sleeping') {
    showStatus('Sleeping. Say your unlock or shutdown phrase.');
    return;
  }
  if (code === settings.lockCode) {
    await enterSleep();
    return;
  }
  playLocalVoiceCue('status');
  await api('/api/voice/approval-codes', {
    method: 'POST',
    suppressAuthGuidance: true,
    body: JSON.stringify({
      deviceId: state.config.deviceId,
      token: state.config.deviceToken,
      voiceSessionId: state.voiceSessionId || '',
      code,
      source: 'desktop',
      protocolVersion: 1,
    }),
  });
  showStatus(`Approval sent: ${code}.`);
  await loadDashboard();
}

async function applySleepPhraseMatch(match) {
  if (match === 'unlock') {
    playLocalVoiceCue('unlock');
    setMode('awake', 'Unlocked.');
    const awakeSettings = await loadVoiceSettings(true).catch(() => state.voiceSettings);
    await applyDesktopVoskGrammar('awake', awakeSettings);
    startWakeListener();
    return;
  }
  if (match === 'shutdown') {
    await turnOff({ cue: 'sleeping_off' });
  }
}

async function processPhraseText(text, finalizeNow = false, finalResult = false) {
  const settings = await loadVoiceSettings().catch(() => null);
  if (state.mode !== 'sleeping' && shouldSuppressWakeCommandsForPlayback()) {
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'ignored', reason: 'assistant playback' });
    return;
  }
  if (state.mode !== 'sleeping' && acceptApprovalText(text, finalizeNow)) return;
  if (state.mode === 'recording') {
    showStatus('Recording. Wake commands are ignored until capture stops.');
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'ignored', reason: 'recording' });
    void logDesktopEvent('info', 'Wake phrase ignored while recording', { text });
    return;
  }
  if (state.mode === 'paused') {
    showStatus(pausedStatus(state.voiceTarget));
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'ignored', reason: 'recording paused' });
    void logDesktopEvent('info', 'Wake phrase ignored while recording is paused', { text });
    return;
  }
  if (state.mode === 'sleeping') {
    const sleepMatch = stableSleepPhraseMatch(text, settings, finalResult);
    if (sleepMatch.status === 'matched') {
      void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'matched', command: sleepMatch.match });
      await applySleepPhraseMatch(sleepMatch.match);
      return;
    }
    if (sleepMatch.status === 'pending') {
      showStatus('Sleeping. Recognized possible sleep command.');
      void recordCommandRecognitionLog({
        text,
        final: finalResult,
        outcome: 'pending',
        command: sleepMatch.match,
        reason: sleepMatch.complete ? 'waiting for stability' : 'phrase prefix',
      });
      return;
    }
    showStatus('Sleeping. Say your unlock or shutdown phrase.');
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'unmatched', reason: 'sleep command not matched' });
    return;
  }
  if (settings && globalThis.VoicePhrases?.matchesPhrase(text, settings.shutdownPhrase)) {
    void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'matched', command: 'shutdown' });
    await turnOff({ cue: 'sleeping_off' });
    return;
  }
  const match = wakePhraseMatch(text, state.voiceSettings?.assistantProfiles || []);
  if (!match) {
    const heard = String(text || '').trim();
    showStatus(heard ? `Heard "${heard}". No voice command matched.` : 'No voice command matched.');
    void recordCommandRecognitionLog({ text: heard, final: finalResult, outcome: 'unmatched', reason: 'awake command not matched' });
    void logDesktopEvent('info', 'Wake phrase did not match command', { text: heard });
    return;
  }
  void recordCommandRecognitionLog({ text, final: finalResult, outcome: 'matched', command: match.command });
  void logDesktopEvent('info', 'Wake command matched', { text, command: match.command, assistantProfileId: match.assistantProfileId || null });
  if (match.command === 'sleep') {
    await enterSleep();
    return;
  }
  if (match.command === 'stop_audio') {
    const stopped = stopSpeechPlayback({ clearQueue: false });
    showStatus(stopped ? 'Assistant audio stopped.' : 'No assistant audio is playing.');
    return;
  }
  if (match.command === 'repeat_audio') {
    const repeated = repeatLastSpeechPlayback();
    showStatus(repeated ? 'Repeating assistant audio.' : 'No assistant audio to repeat.');
    return;
  }
  if (match.command === 'status') {
    playLocalVoiceCue('status');
    showStatus(`Mode: ${state.mode}. Device: ${state.config?.deviceId ? state.config.deviceId.slice(0, 12) : 'unpaired'}.`);
    return;
  }
  if (state.mode === 'off') enterAwake();
  await startMic(match.command === 'patch' || match.command === 'clipboard' ? match.command : 'assistant', { cue: 'wake', assistantProfileId: match.assistantProfileId });
}

async function startWakeAudioCapture() {
  const media = await getMicrophoneStream();
  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(media);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    handleWakeAudioFrame(floatToPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate));
  };
  source.connect(analyser);
  source.connect(processor);
  processor.connect(context.destination);
  state.wakeStream = media;
  state.wakeAudioContext = context;
  state.wakeAnalyser = analyser;
  state.wakeProcessor = processor;
  return true;
}

function startWakeListener() {
  if (state.wakeStarting || state.wakeStream || state.recognition) {
    showStatus(wakeListenerStatus());
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
      if (state.mode !== 'sleeping' && text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
      state.lastRecognizedText = text;
      state.lastRecognizedAt = now;
      void processPhraseText(text, false, Boolean(result?.final)).catch((err) => showStatus(err.message));
    });

    await startWakeAudioCapture();
    state.wakeUnsubscribe = unsubscribe;
    showStatus(wakeListenerStatus('Awake. Listening with Vosk.'));
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
    showStatus(state.mode === 'sleeping' ? sleepingStatusText() : 'Awake. Wake phrase recognition is unavailable in this runtime.');
    return;
  }
  if (state.recognition) {
    showStatus(wakeListenerStatus());
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
    if (state.mode !== 'sleeping' && text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
    state.lastRecognizedText = text;
    state.lastRecognizedAt = now;
    void processPhraseText(text, false, Boolean(result?.isFinal)).catch((err) => showStatus(err.message));
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
    showStatus(wakeListenerStatus());
  } catch {
    state.recognition = null;
    showStatus(state.mode === 'sleeping' ? sleepingStatusText() : 'Awake. Wake phrase recognition is unavailable in this runtime.');
  }
}

function sleepingStatusText() {
  return els.micStatus.textContent && state.mode === 'sleeping' ? els.micStatus.textContent : 'Sleeping.';
}

function wakeListenerStatus(awakeStatus = 'Awake. Listening for voice commands.') {
  return state.mode === 'sleeping' ? sleepingStatusText() : awakeStatus;
}

function stopWakeRecognizerOnly() {
  resetSleepPhraseCandidate();
  if (state.wakeUnsubscribe) state.wakeUnsubscribe();
  state.wakeUnsubscribe = null;
  state.wakeUsesVosk = false;
  const recognition = state.recognition;
  if (recognition) {
    recognition.onend = null;
    state.recognition = null;
    try {
      recognition.stop();
    } catch {
      // Ignore already-ended SpeechRecognition sessions.
    }
  }
  state.wakeStarting = false;
  if (desktop.stopVosk) void desktop.stopVosk();
}

function adoptWakeAudioCaptureForRecording() {
  if (!state.wakeStream || !state.wakeAudioContext || !state.wakeProcessor) return false;
  stopWakeRecognizerOnly();
  state.stream = state.wakeStream;
  state.audioContext = state.wakeAudioContext;
  state.processor = state.wakeProcessor;
  state.analyser = state.wakeAnalyser;
  state.wakeStream = null;
  state.wakeAudioContext = null;
  state.wakeAnalyser = null;
  state.wakeProcessor = null;
  return true;
}

function stopWakeListener() {
  resetSleepPhraseCandidate();
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
  state.wakeAnalyser = null;
  if (state.wakeStream) state.wakeStream.getTracks().forEach((track) => track.stop());
  state.wakeStream = null;
  if (state.wakeAudioContext) void state.wakeAudioContext.close().catch(() => {});
  state.wakeAudioContext = null;
  state.wakeStarting = false;
  if (desktop.stopVosk) void desktop.stopVosk();
}

function renderMeter() {
  if (!state.analyser || !state.stream) return;
  if (state.recordingPaused || state.mode === 'paused') {
    els.meterBar.style.width = '0%';
    state.meterFrame = requestAnimationFrame(renderMeter);
    return;
  }
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  els.meterBar.style.width = `${Math.min(100, Math.round(average))}%`;
  state.meterFrame = requestAnimationFrame(renderMeter);
}

async function togglePrimaryVoice() {
  if (state.mode === 'paused') {
    resumeRecording();
    return;
  }
  if (state.mode === 'recording' || state.mode === 'transcribing') {
    if (state.transcriptionShortcutActive && state.voiceTarget === 'clipboard') {
      await stopMic(transcriptionReturnMode(), { finalStatus: transcriptionReturnStatus() });
    } else {
      await stopMic('awake');
    }
    return;
  }
  if (state.mode === 'awake') {
    await enterSleep();
    return;
  }
  await enterAwake();
}

async function toggleTranscriptionShortcut(overlayRestore = null) {
  const now = Date.now();
  if (now - state.lastTranscriptionShortcutAt < 300) {
    restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
    return;
  }
  state.lastTranscriptionShortcutAt = now;
  if (!state.config?.deviceId || !state.config?.deviceToken) {
    showStatus('Connect this desktop before recording transcription.');
    restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
    return;
  }
  if (state.mode === 'transcribing') {
    showStatus('Voice transcription is already running.');
    restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
    return;
  }
  if (state.mode === 'paused') {
    if (state.voiceTarget !== 'clipboard') {
      showStatus('Assistant voice recording is paused.');
      restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
      return;
    }
    await stopMic(transcriptionReturnMode(), { cue: 'stop_button', finalStatus: transcriptionReturnStatus() });
    return;
  }
  if (state.mode === 'recording') {
    if (state.voiceTarget !== 'clipboard') {
      showStatus('Assistant voice is already recording.');
      restoreTemporaryTranscriptionOverlay(overlayRestore, 650);
      return;
    }
    await stopMic(transcriptionReturnMode(), { cue: 'stop_button', finalStatus: transcriptionReturnStatus() });
    return;
  }
  beginTranscriptionShortcutSession(overlayRestore);
  try {
    await startMic('clipboard', { cue: 'clipboard_recording_start', ignoreCommands: true });
  } catch (error) {
    finishTranscriptionShortcutOverlay();
    throw error;
  }
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
if (els.callRecorderButton) {
  els.callRecorderButton.addEventListener('click', () => {
    void toggleCallRecorder().catch((err) => {
      renderCallRecorderStatus({ mode: 'error', error: err?.message || String(err), message: err?.message || 'Computer audio recording failed.' });
      showStatus(err?.message || 'Computer audio recording failed.');
    });
  });
}
if (els.callRecorderOpenButton) {
  els.callRecorderOpenButton.addEventListener('click', () => {
    if (desktop.openCallRecorderFile) void desktop.openCallRecorderFile().catch((err) => showStatus(err?.message || 'Could not open recording history.'));
  });
}
if (els.assistantSpeechPlaybackButton) {
  els.assistantSpeechPlaybackButton.addEventListener('click', () => {
    void toggleAssistantSpeechPlayback().catch((err) => showStatus(err?.message || 'Could not save assistant speech setting.'));
  });
}
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
if (els.refreshQrButton) {
  els.refreshQrButton.addEventListener('click', () => {
    void startLocalDesktopAuthQr().catch((err) => {
      updateAuthStatus('error', err?.message || 'Could not refresh QR.');
      setDesktopAuthQrStatus(err?.message || 'Could not refresh QR.', 'error');
    });
  });
}
if (els.inputDeviceButton) {
  els.inputDeviceButton.addEventListener('click', () => toggleDevicePicker(els.inputDeviceSelect));
}
if (els.outputDeviceButton) {
  els.outputDeviceButton.addEventListener('click', () => toggleDevicePicker(els.outputDeviceSelect));
}
if (els.settingsButton) {
  els.settingsButton.addEventListener('click', () => toggleSettingsPanel());
}
if (els.audioSettingsTab) {
  els.audioSettingsTab.addEventListener('click', () => {
    selectSettingsTab('audio');
    void refreshAudioDevicePickers();
  });
}
if (els.shortcutsSettingsTab) {
  els.shortcutsSettingsTab.addEventListener('click', () => {
    selectSettingsTab('shortcuts');
    if (desktop.shortcutStatus) {
      void desktop.shortcutStatus().then((status) => {
        state.shortcutStatus = normalizeShortcutStatusPayload(status);
        renderShortcutSettings();
      }).catch(() => undefined);
    }
  });
}
if (els.logsSettingsTab) {
  els.logsSettingsTab.addEventListener('click', () => {
    selectSettingsTab('logs');
    void loadCommandLogs().catch((err) => {
      if (els.commandLogStatus) els.commandLogStatus.textContent = err?.message || 'Could not load local command logs.';
    });
  });
}
bindShortcutControls({
  configKey: 'transcriptionShortcut',
  defaultBinding: DEFAULT_TRANSCRIPTION_SHORTCUT,
  captureEl: els.transcriptionShortcutCapture,
  clearEl: els.transcriptionShortcutClear,
  resetEl: els.transcriptionShortcutReset,
  resetInvoker: desktop.resetTranscriptionShortcut ? () => desktop.resetTranscriptionShortcut() : null,
});
bindShortcutControls({
  configKey: 'awakeSleepToggleShortcut',
  defaultBinding: DEFAULT_AWAKE_SLEEP_TOGGLE_SHORTCUT,
  captureEl: els.awakeSleepToggleShortcutCapture,
  clearEl: els.awakeSleepToggleShortcutClear,
  resetEl: els.awakeSleepToggleShortcutReset,
  resetInvoker: desktop.resetAwakeSleepToggleShortcut ? () => desktop.resetAwakeSleepToggleShortcut() : null,
});
bindShortcutControls({
  configKey: 'turnOffShortcut',
  defaultBinding: DEFAULT_TURN_OFF_SHORTCUT,
  captureEl: els.turnOffShortcutCapture,
  clearEl: els.turnOffShortcutClear,
  resetEl: els.turnOffShortcutReset,
  resetInvoker: desktop.resetTurnOffShortcut ? () => desktop.resetTurnOffShortcut() : null,
});
bindShortcutControls({
  configKey: 'pauseResumeShortcut',
  defaultBinding: DEFAULT_PAUSE_RESUME_SHORTCUT,
  captureEl: els.pauseResumeShortcutCapture,
  clearEl: els.pauseResumeShortcutClear,
  resetEl: els.pauseResumeShortcutReset,
  resetInvoker: desktop.resetPauseResumeShortcut ? () => desktop.resetPauseResumeShortcut() : null,
});
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
if (els.suppressWakeDuringPlaybackCheckbox) {
  els.suppressWakeDuringPlaybackCheckbox.addEventListener('change', async () => {
    try {
      applyConfig(await desktop.writeConfig(authSessionFields(readFormConfig())));
      showStatus(els.suppressWakeDuringPlaybackCheckbox.checked ? 'Playback command pause enabled.' : 'Playback command pause disabled.');
    } catch (err) {
      showStatus(err?.message || 'Could not save playback command setting.');
    }
  });
}
if (els.addExtensionFileButton) {
  els.addExtensionFileButton.addEventListener('click', () => {
    void chooseExtensionFile().catch((err) => showStatus(err?.message || 'Could not add extension file.'));
  });
}
if (els.enableWorkspaceExtensionButton) {
  els.enableWorkspaceExtensionButton.addEventListener('click', async () => {
    try {
      if (!desktop.enableWorkspaceExtension) throw new Error('Workspace extension setup is not available.');
      const result = await desktop.enableWorkspaceExtension();
      applyConfig(result.config);
      renderExtensionStatus(result);
      showStatus('Enabled Workspace extension.');
    } catch (err) {
      showStatus(err?.message || 'Could not enable Workspace extension.');
    }
  });
}
if (els.addWorkspaceRootButton) {
  els.addWorkspaceRootButton.addEventListener('click', async () => {
    try {
      if (!desktop.addWorkspaceRoot) throw new Error('Workspace root picker is not available.');
      const result = await desktop.addWorkspaceRoot();
      if (result?.canceled) return;
      applyConfig(result.config);
      renderExtensionStatus(result);
      const rootCount = Array.isArray(result.entry?.config?.workspaceRoots) ? result.entry.config.workspaceRoots.length : 0;
      showStatus(rootCount > 0 ? `Saved ${rootCount} workspace root${rootCount === 1 ? '' : 's'}.` : 'Saved Workspace extension.');
    } catch (err) {
      showStatus(err?.message || 'Could not add workspace root.');
    }
  });
}
if (els.extensionDropzone) {
  for (const eventName of ['dragenter', 'dragover']) {
    els.extensionDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.extensionDropzone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    els.extensionDropzone.addEventListener(eventName, () => {
      els.extensionDropzone.classList.remove('is-dragging');
    });
  }
  els.extensionDropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    const filePath = pathForFile(file);
    if (!filePath) {
      showStatus('Could not read dropped extension file path.');
      return;
    }
    void addExtensionFilePath(filePath).catch((err) => showStatus(err?.message || 'Could not add extension file.'));
  });
  els.extensionDropzone.addEventListener('paste', (event) => {
    const file = event.clipboardData?.files?.[0];
    const filePath = pathForFile(file) || event.clipboardData?.getData('text/plain')?.trim();
    if (!filePath) return;
    event.preventDefault();
    void addExtensionFilePath(filePath).catch((err) => showStatus(err?.message || 'Could not add extension file.'));
  });
  els.extensionDropzone.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void chooseExtensionFile().catch((err) => showStatus(err?.message || 'Could not add extension file.'));
  });
}
if (els.saveExtensionsButton) {
  els.saveExtensionsButton.addEventListener('click', async () => {
    try {
      const raw = els.extensionsConfigInput?.value.trim() || '';
      const extensions = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(extensions)) throw new Error('Extensions config must be a JSON array.');
      validateExtensionConfig(extensions);
      applyConfig(await desktop.writeConfig({ ...state.config, extensions }));
      await refreshExtensionStatus();
      showStatus('Saved local extensions.');
    } catch (err) {
      showStatus(err?.message || 'Could not save local extensions.');
    }
  });
}
if (els.reloadExtensionsButton) {
  els.reloadExtensionsButton.addEventListener('click', async () => {
    try {
      renderExtensionStatus(await desktop.reloadExtensions());
      showStatus('Reloaded local extensions.');
    } catch (err) {
      showStatus(err?.message || 'Could not reload local extensions.');
    }
  });
}
if (els.refreshCommandLogsButton) {
  els.refreshCommandLogsButton.addEventListener('click', () => {
    void loadCommandLogs().catch((err) => showStatus(err?.message || 'Could not refresh local command logs.'));
  });
}
if (els.copyCommandLogsButton) {
  els.copyCommandLogsButton.addEventListener('click', () => {
    void copyCommandLogs().catch((err) => showStatus(err?.message || 'Could not copy local command logs.'));
  });
}
if (els.clearCommandLogsButton) {
  els.clearCommandLogsButton.addEventListener('click', () => {
    void clearCommandLogs().catch((err) => showStatus(err?.message || 'Could not clear local command logs.'));
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
  if (event.key === 'Escape') {
    closeSettingsPanel();
    return;
  }
  if (event.repeat || state.capturingShortcutKey) return;
  const target = event.target;
  const editable = target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (editable) return;
  if (isShortcutMatch(state.config?.awakeSleepToggleShortcut, event)) {
    event.preventDefault();
    void togglePrimaryVoice().catch((err) => showStatus(err?.message || 'Could not toggle voice state.'));
    return;
  }
  if (isShortcutMatch(state.config?.turnOffShortcut, event)) {
    event.preventDefault();
    void turnOff().catch((err) => showStatus(err?.message || 'Could not turn voice off.'));
    return;
  }
  if (isShortcutMatch(state.config?.pauseResumeShortcut, event)) {
    event.preventDefault();
    void togglePauseResumeRecording().catch((err) => showStatus(err?.message || 'Could not pause or resume recording.'));
    return;
  }
  const assistantRecordingShortcut = assistantRecordingShortcutFromEvent(event);
  if (assistantRecordingShortcut) {
    event.preventDefault();
    void startAssistantRecordingShortcut({ assistantProfileId: assistantRecordingShortcut.assistantProfileId }).catch((err) => showStatus(err?.message || 'Could not start assistant recording.'));
    return;
  }
  if (!isShortcutMatch(state.config?.transcriptionShortcut, event)) return;
  event.preventDefault();
  void (async () => {
    const overlayRestore = state.mode === 'recording' ? null : await prepareFocusedWindowTranscriptionOverlay();
    await toggleTranscriptionShortcut(overlayRestore);
  })().catch((err) => showStatus(err?.message || 'Could not toggle transcription.'));
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

if (desktop.onTranscriptionShortcut) {
  desktop.onTranscriptionShortcut((payload) => {
    void toggleTranscriptionShortcut(payload).catch((err) => showStatus(err?.message || 'Could not toggle transcription.'));
  });
}

if (desktop.onAwakeSleepToggleShortcut) {
  desktop.onAwakeSleepToggleShortcut(() => {
    void togglePrimaryVoice().catch((err) => showStatus(err?.message || 'Could not toggle voice state.'));
  });
}

if (desktop.onTurnOffShortcut) {
  desktop.onTurnOffShortcut(() => {
    void turnOff().catch((err) => showStatus(err?.message || 'Could not turn voice off.'));
  });
}

if (desktop.onPauseResumeShortcut) {
  desktop.onPauseResumeShortcut(() => {
    void togglePauseResumeRecording().catch((err) => showStatus(err?.message || 'Could not pause or resume recording.'));
  });
}

if (desktop.onAssistantRecordingShortcut) {
  desktop.onAssistantRecordingShortcut((payload) => {
    void startAssistantRecordingShortcut(payload).catch((err) => showStatus(err?.message || 'Could not start assistant recording.'));
  });
}

if (desktop.onShortcutStatus) {
  desktop.onShortcutStatus((status) => {
    state.shortcutStatus = normalizeShortcutStatusPayload(status);
    renderShortcutSettings();
  });
}

if (desktop.onCallRecorderStatus) {
  desktop.onCallRecorderStatus((status) => {
    renderCallRecorderStatus(status);
  });
}

if (desktop.windowState) {
  desktop.windowState().then(applyWindowState).catch(() => applyWindowState({ compact: true }));
}

if (desktop.onDesktopAuthClaimed) {
  desktop.onDesktopAuthClaimed((config) => {
    applyConfig(config);
    void desktop.expandWindow?.().then(applyWindowState);
    ensureControlSocket();
    updateAuthStatus('ok', `Desktop connected to ${trimSlash(config.serverUrl)}.`);
    showPairingMessage(`Desktop connected to ${trimSlash(config.serverUrl)}.`);
    showStatus('Desktop connected.');
    void loadDashboard().catch((err) => showStatus(err.message));
  });
}

desktop.readConfig().then((config) => {
  applyConfig(config);
  void refreshExtensionStatus();
  void refreshAudioDevicePickers();
  void refreshCallRecorderStatus();
  if (desktop.shortcutStatus) {
    void desktop.shortcutStatus().then((status) => {
      state.shortcutStatus = normalizeShortcutStatusPayload(status);
      renderShortcutSettings();
    }).catch(() => undefined);
  }
  applyWindowState({ compact: state.compact });
  if (!config.deviceId || !config.deviceToken) {
    updateVoiceButtons();
    showStatus('Sign in to start voice.');
    showPairingMessage('Scan the QR with Android or use browser sign-in to connect this desktop.');
    void startLocalDesktopAuthQr().catch((err) => {
      updateAuthStatus('error', err?.message || 'Could not create sign-in QR.');
      setDesktopAuthQrStatus(err?.message || 'Could not create sign-in QR.', 'error');
    });
    return null;
  }
  ensureControlSocket();
  updateVoiceButtons();
  return loadDashboard();
}).catch((err) => showStatus(err.message));
