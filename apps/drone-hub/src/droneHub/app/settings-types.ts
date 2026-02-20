export type LlmProviderId = 'openai' | 'gemini';
export type DroneDeleteMode = 'permanent' | 'archive';
export type ArchiveRetentionId = '1h' | '8h' | '1d' | '1w';
export type ArchiveRuntimePolicy = 'keep-running' | 'stop';

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

export type DeleteActionSettingsResponse = {
  ok: true;
  deleteAction: {
    mode: DroneDeleteMode;
    modeSource: 'settings' | 'default';
    archiveRetention: ArchiveRetentionId;
    archiveRetentionSource: 'settings' | 'default';
    archiveRetentionMs: number;
    archiveRuntimePolicy: ArchiveRuntimePolicy;
    archiveRuntimePolicySource: 'settings' | 'default';
  };
};

export type ArchivedDroneSummary = {
  id: string;
  name: string;
  group: string | null;
  createdAt: string | null;
  archivedAt: string;
  deleteAt: string;
  deleteInMs: number | null;
  archiveRetention: ArchiveRetentionId;
  archiveRetentionMs: number;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
  containerName: string;
  repoPath: string;
};

export type ArchivedDronesResponse = {
  ok: true;
  archived: ArchivedDroneSummary[];
  total: number;
  now: string;
};
