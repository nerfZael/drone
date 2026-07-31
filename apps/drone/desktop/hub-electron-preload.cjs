const { contextBridge, ipcRenderer } = require('electron');

const ZOOM_CHANGED_CHANNEL = 'drone-hub:zoom-changed';

contextBridge.exposeInMainWorld('droneHubDesktop', {
  onZoomChanged(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(ZOOM_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(ZOOM_CHANGED_CHANNEL, listener);
  },
});
