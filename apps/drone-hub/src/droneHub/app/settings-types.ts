import type { AutomationConfig } from './automation-config';
import type { KanbanBoardState } from './kanban-board-state';
import type { TaskPlaybookButton } from '../types';

export type LlmProviderId = 'openai' | 'gemini';
export type DroneDeleteMode = 'permanent' | 'archive';
export type ArchiveRetentionId = '1h' | '8h' | '1d' | '1w';
export type ArchiveRuntimePolicy = 'keep-running' | 'stop';
export type SidebarGroupingMode = 'groups' | 'repos';

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
    sidebarGroupOrder: string[];
    sidebarDroneOrderByGroup: Record<string, string[]>;
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
