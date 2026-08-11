import type { AssistantMessage } from '@drone/assistant-chat';
import type { BlipSessionState, TranscriptEntry } from '@blip/core';
import type { LocalAssistantThinkingLevel } from './local-assistant-model';
export type { LocalAssistantThinkingLevel } from './local-assistant-model';

export type LocalAssistantMessage = AssistantMessage & {
  id: string;
  createdAt: string;
};

export type LocalBlipSessionSnapshot = {
  version: 1;
  state: BlipSessionState;
  transcript: TranscriptEntry[];
};

export type LocalWorkspaceTarget = {
  targetDeviceId: string;
  deviceName: string;
  workspaceId: string;
  workspaceName: string;
  read: boolean;
  write: boolean;
  execute: boolean;
};

export type LocalAssistantPromptImage = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type LocalAssistantQueuedPrompt = {
  id: string;
  prompt: string;
  promptImages: LocalAssistantPromptImage[];
  createdAt: string;
  status: 'queued' | 'failed';
  error: string | null;
};

export type LocalAssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  status: 'idle' | 'running' | 'error';
  error: string | null;
  autoApprove?: boolean;
  agentPermissionMode?: 'read' | 'write' | 'execute';
  approvalPolicy?: 'ask' | 'none';
  artifactWorkspace?: boolean;
  workspaceTargets: LocalWorkspaceTarget[];
  messages: LocalAssistantMessage[];
  queuedPrompts: LocalAssistantQueuedPrompt[];
};

export type LocalAssistantApproval = {
  id: string;
  threadId: string;
  toolName: 'bash';
  label: string;
  args: any;
  createdAt: string;
};

export type LocalAssistantSettings = {
  provider: 'openai' | 'codex';
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  hasApiKey: boolean;
  hasCodexAuth: boolean;
};
