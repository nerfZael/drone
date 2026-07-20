import React from 'react';
import { createRoot } from 'react-dom/client';
import DroneHubApp from './DroneHubApp';
import { installDirectApiFetch } from './droneHub/app/direct-api-fetch';
import { registerPwa } from './register-pwa';
import { useDroneHubUiStore } from './droneHub/app/use-drone-hub-ui-store';
import { applyDesktopTheme } from './theme';
import '@excalidraw/excalidraw/index.css';
import './styles.css';

applyDesktopTheme(useDroneHubUiStore.getState().themeId);
installDirectApiFetch();
registerPwa();

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <DroneHubApp />
  </React.StrictMode>
);
