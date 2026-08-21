/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRONE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly droneHubDesktop?: {
    onNavigationZoom(callback: (payload: { action?: unknown }) => void): () => void;
  };
}

declare const __DRONE_HUB_BUILD_ID__: string;
declare const __DRONE_HUB_BUILD_TIME__: string;
