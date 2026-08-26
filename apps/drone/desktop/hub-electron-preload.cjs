const { contextBridge, ipcRenderer } = require('electron');

const NAVIGATION_ZOOM_CHANNEL = 'drone-hub:navigation-zoom';
const DESKTOP_TITLE_BAR_HEIGHT = 29;

window.addEventListener('DOMContentLoaded', () => {
  // Frameless Electron windows do not participate in X11 synchronized resize,
  // so Linux keeps its native frame and must not reserve a second title bar.
  if (process.platform === 'linux') return;

  document.documentElement.dataset.droneHubDesktop = 'true';

  const style = document.createElement('style');
  style.dataset.droneHubDesktopTitleBar = 'true';
  style.textContent = `
    html[data-drone-hub-desktop='true'] body {
      height: calc(100vh - ${DESKTOP_TITLE_BAR_HEIGHT}px) !important;
      margin-top: ${DESKTOP_TITLE_BAR_HEIGHT}px !important;
    }
    html[data-drone-hub-desktop='true'] #root {
      height: 100% !important;
    }
    html[data-drone-hub-desktop='true'] [data-drone-app-shell='true'] {
      top: ${DESKTOP_TITLE_BAR_HEIGHT}px !important;
      bottom: 0 !important;
      height: calc(100vh - ${DESKTOP_TITLE_BAR_HEIGHT}px) !important;
    }
    .drone-hub-desktop-title-bar {
      position: fixed;
      z-index: 2147483647;
      top: 0;
      right: 0;
      left: 0;
      height: ${DESKTOP_TITLE_BAR_HEIGHT}px;
      display: grid;
      place-items: center;
      box-shadow: 0 1px 0 var(--app-header-border, #3b4557);
      background: var(--app-header-bg, #171d27);
      color: var(--muted-dim, #858ea3);
      font: 600 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: .01em;
      user-select: none;
      -webkit-app-region: drag;
    }
    @supports (height: 100dvh) {
      html[data-drone-hub-desktop='true'] body {
        height: calc(100dvh - ${DESKTOP_TITLE_BAR_HEIGHT}px) !important;
      }
      html[data-drone-hub-desktop='true'] [data-drone-app-shell='true'] {
        height: calc(100dvh - ${DESKTOP_TITLE_BAR_HEIGHT}px) !important;
      }
    }
  `;
  document.head.appendChild(style);

  const titleBar = document.createElement('div');
  titleBar.className = 'drone-hub-desktop-title-bar';
  titleBar.textContent = 'Drone Hub';
  titleBar.setAttribute('aria-hidden', 'true');
  document.body.prepend(titleBar);
});

contextBridge.exposeInMainWorld('droneHubDesktop', {
  onNavigationZoom(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(NAVIGATION_ZOOM_CHANNEL, listener);
    return () => ipcRenderer.removeListener(NAVIGATION_ZOOM_CHANNEL, listener);
  },
});
