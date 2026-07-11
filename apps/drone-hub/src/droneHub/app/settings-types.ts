import type { AutomationConfig } from './automation-config';
import type { KanbanBoardState } from './kanban-board-state';
import type { TaskPlaybookButton } from '../types';

export type LlmProviderId = 'openai' | 'gemini' | 'codex';
export type DroneDeleteMode = 'permanent' | 'archive';
export type ArchiveRetentionId = '1h' | '8h' | '1d' | '1w';
export type ArchiveRuntimePolicy = 'keep-running' | 'stop';
export type SidebarGroupingMode = 'groups' | 'repos';
export type SidebarDensityMode = 'compact' | 'default' | 'comfortable';
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
  provider: {
    selected: LlmProviderId;
    source: 'settings' | 'environment' | 'default';
  };
  openai: Omit<ApiKeySettingsResponse, 'ok'>;
  gemini: Omit<ApiKeySettingsResponse, 'ok'>;
  codex: Omit<ApiKeySettingsResponse, 'ok'>;
  groq: Omit<ApiKeySettingsResponse, 'ok'>;
  voiceStreamPairingPassword: {
    hasPassword: boolean;
    source: 'settings' | 'environment' | null;
    passwordHint: string | null;
    updatedAt: string | null;
  };
};

export type VoiceStreamPairingPasswordSettingsResponse = {
  ok: true;
  hasPassword: boolean;
  source: 'settings' | 'environment' | null;
  passwordHint: string | null;
  updatedAt: string | null;
  password?: string | null;
};

export type DesktopVoiceModelCatalogEntry = {
  id: string;
  label: string;
  language: string;
  size: string;
  bundled: boolean;
  url: string;
  archiveName: string;
  extractedDirName: string;
  sourceUrl: string;
};

export type DesktopVoiceModelSettingsResponse = {
  ok: true;
  state: 'missing' | 'installed' | 'installing' | 'error';
  installed: boolean;
  modelDir: string | null;
  message: string;
  error: string | null;
  installing: boolean;
  installingModelId: string | null;
  selectedModelId: string;
  effectiveModelId: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  catalog: DesktopVoiceModelCatalogEntry[];
};

export type VoiceApprovalSettings = {
  triggerPhrase: string;
  unlockCode: string;
  lockCode: string;
  lockedOffCode: string;
  minDigits: number;
  maxDigits: number;
  stableMs: number;
  collectTimeoutMs: number;
  duplicateCooldownMs: number;
  finalizeCheckIntervalMs: number;
  postPromptCommandSuppressionMs: number;
};

export type VoiceTranscriptionFinalMode = 'full-recording' | 'segments';
export type VoiceTranscriptionSettings = {
  finalMode: VoiceTranscriptionFinalMode;
};

export type VoiceActivationSettings = {
  normalAliases: string[];
  realTimeAliases: string[];
};

export type VoiceRealtimeProvider = 'openai' | 'native';
export type VoiceRealtimeSettings = {
  enabled: boolean;
  provider: VoiceRealtimeProvider;
};

export type VoiceApprovalSettingsResponse = {
  ok: true;
  profile: {
    activeProfile: string | null;
    scoped: true;
  };
  voiceApproval: VoiceApprovalSettings & {
    source: 'settings' | 'default';
    updatedAt: string | null;
  };
  voiceTranscription: VoiceTranscriptionSettings & {
    source: 'settings' | 'default';
    updatedAt: string | null;
  };
  voiceActivation: VoiceActivationSettings & {
    source: 'settings' | 'default';
    updatedAt: string | null;
  };
  voiceRealtime: VoiceRealtimeSettings & {
    source: 'settings' | 'default';
    updatedAt: string | null;
  };
  defaults: VoiceApprovalSettings;
  transcriptionDefaults: VoiceTranscriptionSettings;
  activationDefaults: VoiceActivationSettings;
  realtimeDefaults: VoiceRealtimeSettings;
  limits: {
    triggerPhraseMaxChars: number;
    codeMaxDigits: number;
    minDigitsMin: number;
    minDigitsMax: number;
    maxDigitsMin: number;
    maxDigitsMax: number;
    stableMsMin: number;
    stableMsMax: number;
    collectTimeoutMsMin: number;
    collectTimeoutMsMax: number;
    duplicateCooldownMsMin: number;
    duplicateCooldownMsMax: number;
    finalizeCheckIntervalMsMin: number;
    finalizeCheckIntervalMsMax: number;
    postPromptCommandSuppressionMsMin: number;
    postPromptCommandSuppressionMsMax: number;
    activationAliasMaxChars: number;
    activationAliasMaxCount: number;
  };
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

export type AgentMessageAutoContinueSettingsResponse = {
  ok: true;
  agentMessageAutoContinue: {
    prompt: string;
    promptSource: 'settings' | 'default';
    enabledByDefault: boolean;
    enabledByDefaultSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    defaultEnabledByDefault: boolean;
    maxPromptChars: number;
  };
};

export type AgentSuggestionSettingsResponse = {
  ok: true;
  agentSuggestion: {
    policyMarkdown: string;
    policyMarkdownSource: 'settings' | 'default';
    enabledByDefault: boolean;
    enabledByDefaultSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPolicyMarkdown: string;
    defaultEnabledByDefault: boolean;
    maxPolicyChars: number;
    policyFingerprint: string;
  };
};

export type AgentsSettingsResponse = {
  ok: true;
  agents: {
    content: string;
    enabled: boolean;
    updatedAt: string | null;
  };
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

export type KanbanBoardSettingsResponse = {
  ok: true;
  kanbanBoard: KanbanBoardState;
  updatedAt: string | null;
};

export type TaskPlaybookButtonSettingsResponse = {
  ok: true;
  taskPlaybookButtons: TaskPlaybookButton[];
  updatedAt: string | null;
};

export type UiPreferencesSettingsResponse = {
  ok: true;
  uiPreferences: {
    sidebarGroupingMode: SidebarGroupingMode;
    sidebarDensityMode: SidebarDensityMode;
    sidebarGroupOrder: string[];
    sidebarDroneOrderByGroup: Record<string, string[]>;
    sidebarNodeOrderByParent: Record<string, string[]>;
    sidebarChatOrderByDrone: Record<string, string[]>;
    hiddenSidebarGroups: string[];
    autoDelete: boolean;
    automations: AutomationConfig[];
    spawnAgentKey: string;
    spawnModel: string;
    repoBranchSource: 'host' | 'remote';
    repoCreateRemoteBranch: string;
    pullHostBranchBeforeCreate: boolean;
  };
  updatedAt: string | null;
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
