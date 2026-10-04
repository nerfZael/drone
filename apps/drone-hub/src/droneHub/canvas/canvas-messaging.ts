import type { ChatModelOverrides } from '../chat/selected-chat-model-overrides';
import type { ChatSendContext, ChatSendPayload } from '../chat/ChatInput';
import type { AgentApprovalPolicy, AgentPermissionMode } from '../../domain';

export type CanvasChatTarget = { droneId: string; chatName: string };
export type CanvasSendPrompt = (
  targets: CanvasChatTarget[],
  payload: ChatSendPayload,
  context: ChatSendContext,
  overrides?: ChatModelOverrides,
) => Promise<{ ok: boolean; error?: string | null }>;

export type CanvasDraftCreation = {
  draftNodeId: string;
  prompt: string;
  attachments?: ChatSendPayload['attachments'];
  label: string;
  overrides: {
    agentKey: string;
    model: string;
    reasoning?: string;
    permissionMode?: AgentPermissionMode;
    approvalPolicy?: AgentApprovalPolicy;
    repoPath: string;
    group: string;
  };
};
