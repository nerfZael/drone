/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DRONE_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __DRONE_HUB_BUILD_ID__: string;
declare const __DRONE_HUB_BUILD_TIME__: string;
