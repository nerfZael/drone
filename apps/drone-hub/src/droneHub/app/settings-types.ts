import type { NativeAgentDefaultSettings } from '@drone/assistant-chat';

export type LlmProviderId = 'openai' | 'gemini' | 'codex' | 'openrouter';
export type DroneDeleteMode = 'permanent' | 'archive';
export type ArchiveRetentionId = '1h' | '8h' | '1d' | '1w';
export type ArchiveRuntimePolicy = 'keep-running' | 'stop';
export type SidebarGroupingMode = 'groups' | 'repos';
export type SidebarDensityMode = 'compact' | 'default' | 'comfortable';
export type ReadingDensityMode = 'default' | 'comfortable';
export type SyncSetSourceType = 'hub-managed' | 'host-path';
export type SyncSetTargetStatusState = 'idle' | 'synced' | 'error';

export type ApiKeySettingsResponse = {
  ok: true;
  hasKey: boolean;
  source: 'settings' | 'environment' | null;
  keyHint: string | null;
  updatedAt: string | null;
  apiKey?: string | null;
};

export type LlmSettingsResponse = {
  ok: true;
  namingProvider?: LlmProviderId;
  provider: {
    selected: LlmProviderId;
    source: 'settings' | 'environment' | 'default';
  };
  openai: Omit<ApiKeySettingsResponse, 'ok'>;
  gemini: Omit<ApiKeySettingsResponse, 'ok'>;
  codex: Omit<ApiKeySettingsResponse, 'ok'>;
  openrouter: Omit<ApiKeySettingsResponse, 'ok'>;
  groq: Omit<ApiKeySettingsResponse, 'ok'>;
};

export type LlmDefaultModelSettingsResponse = NativeAgentDefaultSettings;

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

export type FilesystemSettingsResponse = {
  ok: true;
  filesystem: {
    uploadMaxBytes: number;
    uploadMaxBytesSource: 'settings' | 'default';
    minUploadMaxBytes: number;
    maxUploadMaxBytes: number;
    defaultUploadMaxBytes: number;
  };
};

export type SpeechSettingsResponse = {
  ok: true;
  speech: {
    enabled: boolean;
    muted: boolean;
    volume: number;
    voice: string;
    voices: readonly string[];
  };
};

export type VoiceInputSettingsResponse = {
  ok: true;
  voiceInput: {
    endThoughtPreset: 'quick' | 'balanced' | 'patient' | 'custom';
    customSilenceMillis: number;
    silenceMillis: number;
    noiseHandling: 'auto' | 'quiet' | 'noisy';
    language: string | null;
    quality: 'fast' | 'accurate';
    confirmationFeedback: boolean;
  };
};

export type RegistryBackupKind = 'hourly' | 'daily' | 'manual' | 'suspect';

export type RegistryBackupManifest = {
  backupVersion: 1;
  source: 'drone-hub';
  id: string;
  kind: RegistryBackupKind;
  createdAt: string;
  bucket: string;
  scheduledKind?: 'hourly' | 'daily' | 'manual';
  scheduledBucket?: string;
  suspect: boolean;
  reason: string | null;
  paths: {
    sqlite: string | null;
    registryJson: string;
    manifest: string;
  };
  counts: {
    drones: number;
    pending: number;
    archived: number;
    total: number;
  };
  sha256: {
    sqlite: string | null;
    registryJson: string;
  };
  validation: {
    sqliteReadable: boolean;
    registryJsonReadable: boolean;
  };
};

export type RegistryBackupSettingsResponse = {
  ok: true;
  backupSettings: {
    enabled: boolean;
    hourlyEnabled: boolean;
    dailyEnabled: boolean;
    hourlyRetentionHours: number;
    dailyRetentionDays: number;
    source: 'settings' | 'default';
    updatedAt: string | null;
  };
  backupDir: string;
  sqlitePath: string;
  next: {
    hourlyDue: boolean;
    dailyDue: boolean;
    nextCheckAt: string | null;
  };
  last: RegistryBackupManifest | null;
  recent: RegistryBackupManifest[];
  createdBackup?: RegistryBackupManifest | null;
};

export type AgentsMdFileSummary = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentsMdFile = AgentsMdFileSummary & {
  content: string;
};

export type AgentsSettingsResponse = {
  ok: true;
  agents: {
    content: string;
    enabled: boolean;
    updatedAt: string | null;
  };
  files: AgentsMdFileSummary[];
};

export type AgentsFileResponse = AgentsSettingsResponse & {
  file: AgentsMdFile;
};

export type GithubSettingsResponse = {
  ok: true;
  github: {
    pullRequestTransport: 'github-api';
    authReady: boolean;
    authSource: 'environment' | 'gh' | null;
    authEnvKey: string | null;
    authDetail: string;
    ghCliInstalled: boolean;
    ghCliAuthenticated: boolean;
    ghCliPath: string | null;
    ghCliVersion: string | null;
  };
};

export type ResourceSubscriptionSettings = {
  enabled: boolean;
  githubPollingIntervalMs: number;
  batchWindowMs: number;
  maxEventsPerPrompt: number;
  maxActiveSubscriptionsPerConversation: number;
  maxAutomatedRunsPerConversationPerHour: number;
  deliveryRetryLimit: number;
  terminalEventRetentionDays: number;
  deliveryRetentionDays: number;
};

export type ResourceSubscriptionSettingsResponse = {
  ok: true;
  settings: ResourceSubscriptionSettings;
};

export type UiPreferencesSettingsResponse = {
  ok: true;
  uiPreferences: {
    sidebarGroupingMode: SidebarGroupingMode;
    sidebarDensityMode: SidebarDensityMode;
    collapsedGroups: Record<string, boolean>;
    collapsedDroneSections: Record<string, boolean>;
    sidebarGroupOrder: string[];
    sidebarDroneOrderByGroup: Record<string, string[]>;
    sidebarNodeOrderByParent: Record<string, string[]>;
    sidebarChatOrderByDrone: Record<string, string[]>;
    sidebarChatGroupPathsByDrone: Record<string, string[]>;
    sidebarChatGroupByChat: Record<string, string>;
    sidebarChatNodeOrderByParent: Record<string, string[]>;
    pinnedDroneIds: string[];
    mutedSidebarGroupIds: string[];
    mutedDroneIds: string[];
    mutedChatIds: string[];
    hiddenSidebarGroups: string[];
    spawnAgentKey: string;
    spawnModel: string;
    spawnReasoning: string;
    spawnAgentPermissionMode: 'read' | 'write' | 'execute';
    spawnApprovalPolicy: 'ask' | 'auto' | 'none';
    repoBranchSource: 'host' | 'remote';
    repoCreateRemoteBranch: string;
    spawnContextByRepoKey: Record<
      string,
      {
        spawnAgentKey: string;
        spawnModel: string;
        spawnReasoning: string;
        spawnAgentPermissionMode: 'read' | 'write' | 'execute';
        spawnApprovalPolicy: 'ask' | 'auto' | 'none';
        repoBranchSource: 'host' | 'remote';
        repoCreateRemoteBranch: string;
      }
    >;
  };
  updatedAt: string | null;
  version: number | null;
};

export type ProfileSettingsProfile = {
  name: string;
  active: boolean;
  rootDir: string;
  droneDataDir: string;
  dvmDataDir: string;
};

export type ProfileSettingsResponse = {
  ok: true;
  activeProfile: string | null;
  mode: 'profile';
  droneDataDir: string;
  dvmDataDir: string;
  profiles: ProfileSettingsProfile[];
  createdProfile?: string;
  activatedProfile?: string;
  deletedProfile?: string;
  renamedFrom?: string;
  renamedTo?: string;
  removedContainers?: string[];
  removedHostRoots?: string[];
  reloadRequired?: boolean;
};

export type SyncSetTargetStatus = {
  targetId: string;
  targetName: string;
  targetKind: 'drone' | 'host';
  state: SyncSetTargetStatusState;
  appliedVersionId: string | null;
  appliedAt: string | null;
  error: string | null;
};

export type SyncSet = {
  id: string;
  label: string;
  sourceType: SyncSetSourceType;
  sourcePath: string | null;
  targetPath: string;
  applyToHost: boolean;
  scope: { type: 'all' };
  createdAt: string;
  updatedAt: string;
  lastAppliedVersionId: string | null;
  lastAppliedAt: string | null;
  managedSourcePath: string;
  effectiveSourcePath: string;
  sourceExists: boolean;
  targetStatus: SyncSetTargetStatus[];
};

export type SyncSetsResponse = {
  ok: true;
  syncSets: SyncSet[];
  updatedAt: string | null;
};

export type SyncSetApplyFailure = {
  targetId: string;
  targetName: string;
  error: string;
};

export type SyncSetApplyResponse = {
  ok: true;
  syncSet: SyncSet | null;
  appliedDrones: number;
  totalDrones: number;
  appliedHost: boolean;
  failures: SyncSetApplyFailure[];
  versionId: string;
  sourcePath: string;
  fileCount: number;
  totalBytes: number;
};

export type SetupDependencyStatus = 'ready' | 'missing' | 'warning';

export type SetupDependencyCheck = {
  id: string;
  label: string;
  status: SetupDependencyStatus;
  blocking: boolean;
  requiredFor: string;
  detail: string;
};

export type SetupStatusResponse = {
  ok: true;
  firstHubStartedAt: string | null;
  welcomeDismissedAt: string | null;
  shouldShowWelcome: boolean;
  activeProfile: string | null;
  mode: 'profile';
  profile: {
    activeProfile: string | null;
    droneCount: number;
    repoCount: number;
    isFresh: boolean;
    droneDataDir: string;
    dvmDataDir: string;
  };
  dependencies: SetupDependencyCheck[];
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

export type ArchivedChatSummary = {
  droneId: string;
  droneName: string;
  chatName: string;
  archivedAt: string;
  deleteAt: string;
  deleteInMs: number | null;
  archiveRetention: ArchiveRetentionId;
  archiveRetentionMs: number;
};

export type ArchivedChatsResponse = {
  ok: true;
  archived: ArchivedChatSummary[];
  total: number;
  now: string;
};
