import type { AutomationConfig } from './automation-config';
import type { KanbanBoardState } from './kanban-board-state';
import type { TaskPlaybookButton } from '../types';

export type LlmProviderId = 'openai' | 'gemini';
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
