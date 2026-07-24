import type { AgentPermissionMode, ChatAgentConfig } from '../../domain';
import type { ChatImageAttachmentPayload } from '../chat';
import type { PendingPrompt } from '../types';
import type { RepoPullConflict } from './helpers';

export type ChatModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
};

export type AppView = 'workspace' | 'settings';

export type StartupSeedState = {
  droneName: string;
  runtime?: 'container' | 'host';
  chatName: string;
  agent: ChatAgentConfig | null;
  model: string | null;
  reasoning: string | null;
  agentPermissionMode: AgentPermissionMode;
  prompt: string;
  group: string | null;
  repoPath: string | null;
  at: string;
};

export type DraftChatState = {
  // If set, this is the (optimistic) id/name of the drone being created for this draft chat.
  droneId: string;
  droneName: string;
  prompt: PendingPrompt | null;
  queuedPrompts: Array<
    PendingPrompt & {
      attachmentPayloads?: ChatImageAttachmentPayload[];
    }
  >;
  // Changes each time the draft composer is opened so input autofocus can re-trigger.
  focusKey?: string;
};

export type DroneErrorModalState = {
  droneId: string;
  droneName: string;
  message: string;
  conflict: RepoPullConflict;
};
