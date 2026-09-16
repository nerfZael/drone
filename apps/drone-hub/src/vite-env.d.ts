/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRONE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly __DRONE_HUB_RUNTIME_CONFIG__?: {
    readonly desktop?: boolean;
    readonly directApiBase?: string;
    readonly directApiToken?: string;
  };
  readonly droneHubDesktop?: {
    setChatWindowAlwaysOnTop?(name: string, enabled: boolean): Promise<boolean>;
    notificationsSupported?(): Promise<boolean>;
    showNotification?(input: { title: string; body: string; silent: boolean; target?: { droneId: string; chatName: string } }): Promise<void>;
    onNotificationClick?(callback: (target: { droneId: string; chatName: string }) => void): () => void;
    onNotificationError?(callback: (error: string) => void): () => void;
    reportDiagnostic?(record: Record<string, unknown>): void;
    onNavigationZoom(callback: (payload: { action?: unknown }) => void): () => void;
  };
}

declare const __DRONE_HUB_BUILD_ID__: string;
declare const __DRONE_HUB_BUILD_TIME__: string;
