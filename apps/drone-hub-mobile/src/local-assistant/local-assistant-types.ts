import type { AssistantMessage } from '@drone/assistant-chat';

export type LocalAssistantMessage = AssistantMessage & {
  id: string;
  createdAt: string;
};

export type LocalWorkspaceTarget = {
  targetDeviceId: string;
  rootId: string;
  read: boolean;
  write: boolean;
};

export type LocalAssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  status: 'idle' | 'running' | 'error';
  error: string | null;
  workspaceTarget: LocalWorkspaceTarget | null;
  messages: LocalAssistantMessage[];
};

export type LocalAssistantSettings = {
  model: string;
  hasApiKey: boolean;
};
