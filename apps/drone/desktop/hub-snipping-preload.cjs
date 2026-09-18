const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snipping', {
  select: value => ipcRenderer.send('drone-hub:snip-selection', value),
  ready: () => ipcRenderer.send('drone-hub:snip-ready'),
  onStart: callback => ipcRenderer.on('drone-hub:snip-start', (_event, session) => callback(session)),
  onImage: callback => ipcRenderer.on('drone-hub:snip-image', (_event, frame) => callback(frame)),
  onReset: callback => ipcRenderer.on('drone-hub:snip-reset', () => callback()),
});
