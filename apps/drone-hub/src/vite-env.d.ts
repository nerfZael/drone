/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRONE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly __DRONE_HUB_RUNTIME_CONFIG__?: {
    readonly directApiBase?: string;
    readonly directApiToken?: string;
  };
  readonly droneHubDesktop?: {
    onNavigationZoom(callback: (payload: { action?: unknown }) => void): () => void;
  };
}

declare const __DRONE_HUB_BUILD_ID__: string;
declare const __DRONE_HUB_BUILD_TIME__: string;
