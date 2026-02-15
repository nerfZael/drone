export type LlmProviderId = 'openai' | 'gemini';

export type ApiKeySettingsResponse = {
  ok: true;
  hasKey: boolean;
  source: 'settings' | 'environment' | null;
  keyHint: string | null;
  updatedAt: string | null;
};

export type LlmSettingsResponse = {
  ok: true;
  provider: {
    selected: LlmProviderId;
    source: 'settings' | 'environment' | 'default';
  };
  openai: Omit<ApiKeySettingsResponse, 'ok'>;
  gemini: Omit<ApiKeySettingsResponse, 'ok'>;
};

export type HubLogsResponse = {
  ok: true;
  logPath: string;
  text: string;
  truncated: boolean;
  fileSize: number;
  bytesRead: number;
  updatedAt: string | null;
  maxBytes: number;
  tailLines: number;
};
