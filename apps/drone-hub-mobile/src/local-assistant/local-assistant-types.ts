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

export type LocalAssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  status: 'idle' | 'running' | 'error';
  error: string | null;
  workspaceTargets: LocalWorkspaceTarget[];
  messages: LocalAssistantMessage[];
};

export type LocalAssistantSettings = {
  provider: 'openai' | 'codex';
  model: string;
  thinkingLevel: LocalAssistantThinkingLevel;
  hasApiKey: boolean;
  hasCodexAuth: boolean;
};
