import React from 'react';
import { createRoot } from 'react-dom/client';
import { DroneHubDndProvider } from './droneHub/app/drone-hub-dnd';
import { RemoteDroneHubApp } from './remote/RemoteDroneHubApp';
import { registerPwa } from './register-pwa';
import './styles.css';

registerPwa();

const container = document.getElementById('root');
if (!container) throw new Error('Root container not found');

createRoot(container).render(
  <React.StrictMode>
    <DroneHubDndProvider enabled={false}>
      <RemoteDroneHubApp />
    </DroneHubDndProvider>
  </React.StrictMode>,
);
