const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('notificationCard', {
  read: () => ipcRenderer.invoke('drone-hub:notification-card'),
  action: (action) => {
    if (['ready', 'open', 'dismiss', 'pause', 'resume'].includes(action)) ipcRenderer.send('drone-hub:notification-action', action);
  },
});
