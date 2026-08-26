import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import DroneHubApp from './DroneHubApp';
import { installDirectApiFetch } from './droneHub/app/direct-api-fetch';
import { registerPwa } from './register-pwa';
import { useDroneHubUiStore } from './droneHub/app/use-drone-hub-ui-store';
import { applyDesktopTheme } from './theme';
import { applyReadingDensity } from './reading-density';
import { droneHubQueryClient } from './droneHub/query-client';
import '@excalidraw/excalidraw/index.css';
import '@xyflow/react/dist/style.css';
import './styles.css';

applyDesktopTheme(useDroneHubUiStore.getState().themeId);
applyReadingDensity(useDroneHubUiStore.getState().readingDensityMode);
installDirectApiFetch();
registerPwa();

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={droneHubQueryClient}>
      <DroneHubApp />
    </QueryClientProvider>
  </React.StrictMode>
);
