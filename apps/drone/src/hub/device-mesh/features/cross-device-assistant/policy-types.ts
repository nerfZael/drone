export type WorkspaceRoot = { id: string; label: string; path: string };

export type HomeWorkspaceTarget = {
  threadId: string;
  targetDeviceId: string;
  deviceName: string;
  rootId: string;
  workspaceName: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};

export type WorkspaceDeviceGrant = {
  deviceId: string;
  rootId: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};

export type CrossDeviceAssistantPolicy = {
  version: 2;
  roots: WorkspaceRoot[];
  homeTargets: HomeWorkspaceTarget[];
  deviceGrants: WorkspaceDeviceGrant[];
};
