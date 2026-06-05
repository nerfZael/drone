const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('voiceStreamDesktop', {
  isDesktop: true,
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (config) => ipcRenderer.invoke('config:write', config),
  reloadExtensions: () => ipcRenderer.invoke('extensions:reload'),
  extensionStatus: () => ipcRenderer.invoke('extensions:status'),
  addExtensionFile: (filePath) => ipcRenderer.invoke('extensions:addFile', filePath),
  enableWorkspaceExtension: () => ipcRenderer.invoke('extensions:enableWorkspace'),
  addWorkspaceRoot: () => ipcRenderer.invoke('extensions:addWorkspaceRoot'),
  saveWorkspaceRoots: (roots) => ipcRenderer.invoke('extensions:saveWorkspaceRoots', roots),
  chooseExtensionFile: () => ipcRenderer.invoke('extensions:chooseFile'),
  pathForFile: (file) => webUtils?.getPathForFile?.(file) || '',
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  debugWindow: (message, details) => ipcRenderer.invoke('debug:window', message, details),
  appendCommandLog: (entry) => ipcRenderer.invoke('commandLog:append', entry),
  readCommandLogs: () => ipcRenderer.invoke('commandLog:read'),
  clearCommandLogs: () => ipcRenderer.invoke('commandLog:clear'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  windowState: () => ipcRenderer.invoke('window:state'),
  compactWindow: () => ipcRenderer.invoke('window:compact'),
  expandWindow: () => ipcRenderer.invoke('window:expand'),
  signedOutWindow: () => ipcRenderer.invoke('window:signedOut'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  restoreTemporaryOverlay: (payload) => ipcRenderer.invoke('window:restoreTemporaryOverlay', payload),
  setTrayStatus: (status) => ipcRenderer.invoke('tray:status', status),
  shortcutStatus: () => ipcRenderer.invoke('shortcut:status'),
  resetTranscriptionShortcut: () => ipcRenderer.invoke('shortcut:resetTranscription'),
  resetAwakeSleepToggleShortcut: () => ipcRenderer.invoke('shortcut:resetAwakeSleepToggle'),
  resetTurnOffShortcut: () => ipcRenderer.invoke('shortcut:resetTurnOff'),
  resetPauseResumeShortcut: () => ipcRenderer.invoke('shortcut:resetPauseResume'),
  onTranscriptionShortcut: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('shortcut:transcription', listener);
    return () => ipcRenderer.removeListener('shortcut:transcription', listener);
  },
  onAwakeSleepToggleShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:toggleAwakeSleep', listener);
    return () => ipcRenderer.removeListener('shortcut:toggleAwakeSleep', listener);
  },
  onTurnOffShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:turnOff', listener);
    return () => ipcRenderer.removeListener('shortcut:turnOff', listener);
  },
  onPauseResumeShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:pauseResume', listener);
    return () => ipcRenderer.removeListener('shortcut:pauseResume', listener);
  },
  onShortcutStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('shortcut:status', listener);
    return () => ipcRenderer.removeListener('shortcut:status', listener);
  },
  onWindowState: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  voskStatus: () => ipcRenderer.invoke('vosk:status'),
  startVosk: () => ipcRenderer.invoke('vosk:start'),
  stopVosk: () => ipcRenderer.invoke('vosk:stop'),
  resetVosk: () => ipcRenderer.invoke('vosk:reset'),
  setVoskGrammar: (mode, settings) => ipcRenderer.invoke('vosk:setGrammar', mode, settings),
  sendVoskFrame: (frame) => ipcRenderer.send('vosk:frame', frame),
  onVoskStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('vosk:status', listener);
    return () => ipcRenderer.removeListener('vosk:status', listener);
  },
  onVoskText: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('vosk:text', listener);
    return () => ipcRenderer.removeListener('vosk:text', listener);
  },
  onPairingPayload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pairing:payload', listener);
    void ipcRenderer.invoke('pairing:takePending').then((pending) => {
      for (const payload of pending || []) callback(payload);
    });
    return () => ipcRenderer.removeListener('pairing:payload', listener);
  },
});
