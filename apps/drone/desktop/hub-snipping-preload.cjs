const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('snipping', {
  select: value => ipcRenderer.send('drone-hub:snip-selection', value),
  onImage: callback => ipcRenderer.once('drone-hub:snip-image', (_event, data) => callback(data)),
});
