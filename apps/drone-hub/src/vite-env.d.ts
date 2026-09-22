/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRONE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Which way the floating Companion window lays out content away from its bar. */
type CompanionWindowFlow = 'up' | 'down';

type CompanionWindowSize = {
  height: number;
  flow: CompanionWindowFlow;
  /** The bar's height and its distance from the window edge it is docked to. */
  bar: { height: number; inset: number };
};

type CompanionWindowPlacement = {
  flow: CompanionWindowFlow;
  /** Tallest window that keeps the bar in place inside the work area. */
  maxHeight: number;
};

interface Window {
  readonly __DRONE_HUB_RUNTIME_CONFIG__?: {
    readonly desktop?: boolean;
    readonly directApiBase?: string;
    readonly directApiToken?: string;
  };
  readonly droneHubDesktop?: {
    desktopRecording?(action: 'status' | 'start' | 'stop', options?: { title: string; keepAudio: boolean; liveTranscription: boolean }): Promise<import('@drone/hub-model').DesktopRecordingStatus>;
    captureCompanion?(mode: 'region' | 'screen'): Promise<import('@drone/assistant-chat').CompanionImageAttachment | null>;
    setChatWindowAlwaysOnTop?(name: string, enabled: boolean): Promise<boolean>;
    clearNotifications?(): Promise<void>;
    notificationsSupported?(): Promise<boolean>;
    showNotification?(input: { title: string; body: string; silent: boolean; name?: string; kind?: string; durationSeconds?: number; target?: { droneId: string; chatName: string } }): Promise<void>;
    onNotificationClick?(callback: (target: { droneId: string; chatName: string }) => void): () => void;
    onNotificationError?(callback: (error: string) => void): () => void;
    /** Write-only; works while the Hub window is unfocused, unlike the web clipboard API. */
    writeClipboardText?(text: string): Promise<boolean>;
    companionWindow?: {
      control(action: 'show' | 'hide' | 'close' | 'attach' | 'resize' | 'focus-owner' | 'focus', size?: CompanionWindowSize): void;
      onClose(callback: () => void): () => void;
      onPlacement?(callback: (placement: CompanionWindowPlacement) => void): () => void;
    };
    reportDiagnostic?(record: Record<string, unknown>): void;
    onNavigationZoom(callback: (payload: { action?: unknown }) => void): () => void;
  };
}

declare const __DRONE_HUB_BUILD_ID__: string;
declare const __DRONE_HUB_BUILD_TIME__: string;
