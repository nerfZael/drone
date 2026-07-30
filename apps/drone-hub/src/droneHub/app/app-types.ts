import type { ExternalAgentModelCatalogModel } from '@drone/assistant-chat';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
} from '../../domain';
import type { ChatImageAttachmentPayload } from '../chat';
import type { PendingPrompt } from '../types';
import type { RepoPullConflict } from './helpers';

export type ChatModelOption = ExternalAgentModelCatalogModel;

export type AppView = 'workspace' | 'settings';

export type StartupSeedState = {
  droneName: string;
  runtime?: 'container' | 'host';
  chatName: string;
  agent: ChatAgentConfig | null;
  model: string | null;
  reasoning: string | null;
  agentPermissionMode: AgentPermissionMode;
  approvalPolicy: AgentApprovalPolicy;
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
