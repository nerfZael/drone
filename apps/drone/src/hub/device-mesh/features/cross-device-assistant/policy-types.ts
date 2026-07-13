export type WorkspaceRoot = { id: string; label: string; path: string };

export type HomeWorkspaceTarget = {
  threadId: string;
  targetDeviceId: string;
  rootId: string;
  read: boolean;
  write: boolean;
};

export type TargetWorkspaceRule = {
  assistantHomeDeviceId: string;
  threadId: string;
  rootId: string;
  read: boolean;
  write: boolean;
};

export type CrossDeviceAssistantPolicy = {
  version: 1;
  roots: WorkspaceRoot[];
  homeTargets: HomeWorkspaceTarget[];
  targetRules: TargetWorkspaceRule[];
};
