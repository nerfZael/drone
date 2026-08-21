const { contextBridge, ipcRenderer } = require('electron');

const NAVIGATION_ZOOM_CHANNEL = 'drone-hub:navigation-zoom';

contextBridge.exposeInMainWorld('droneHubDesktop', {
  onNavigationZoom(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(NAVIGATION_ZOOM_CHANNEL, listener);
    return () => ipcRenderer.removeListener(NAVIGATION_ZOOM_CHANNEL, listener);
  },
});
