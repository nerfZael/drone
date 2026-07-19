import type { BlipHistoryPage } from '@blip/protocol';
import type { DraftChatAttachment } from '../chat/chat-input-attachments';
import type {
  AssistantDroneNameMap,
  AssistantMessage,
  NativeAgentDefaultSettings,
  NativeAgentModelOption,
  NativeAgentProviderId,
  NativeAgentToolSummary,
  NativeAgentWorkspaceSummary,
  NativeChatAccessScope,
  NativeChatApproval,
  NativeChatSnapshot,
  NativeChatStatus,
  NativeChatThread,
  NativePromptDeliveryMode,
  NativeQueuedPrompt,
} from '@drone/assistant-chat';

export type { AssistantDroneNameMap, AssistantMessage } from '@drone/assistant-chat';

export type AssistantThreadStatus = NativeChatStatus;
export type AssistantProviderId = NativeAgentProviderId;
export type AssistantPromptDeliveryMode = NativePromptDeliveryMode;
export type AssistantAccessScope = NativeChatAccessScope;
export type AssistantThread = NativeChatThread;
export type AssistantQueuedPrompt = NativeQueuedPrompt;
export type AssistantApproval = NativeChatApproval;
export type AssistantModelOption = NativeAgentModelOption;
export type AssistantToolSummary = NativeAgentToolSummary;
export type AssistantWorkspaceSummary = NativeAgentWorkspaceSummary;

export type AssistantScopeUpdateResult = { ok: true; accessScope?: AssistantAccessScope };
export type AssistantScopeMode = 'all' | 'selected';
export type AssistantScopeDrone = { id: string; name: string };
export type AssistantScopeDraft = {
  readMode: AssistantScopeMode;
  writeMode: AssistantScopeMode;
  executeMode: AssistantScopeMode;
  drones: AssistantScopeDrone[];
};
export type PendingAssistantScopeSave = {
  requestId: number;
  threadId: string;
  key: string;
  promise: Promise<boolean>;
};

export type AssistantSnapshot = NativeChatSnapshot;
export type AssistantBootstrapSnapshot = AssistantSnapshot & {
  nativeChatId?: string;
  initialHistory?: BlipHistoryPage;
};
export type AssistantDefaultSettings = NativeAgentDefaultSettings;

export type AssistantSystemPromptSettings = {
  ok: true;
  assistantSystemPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
};

export type AssistantThreadSystemPromptSettings = {
  ok: true;
  threadId: string;
  threadSystemPrompt: {
    prompt: string;
    promptSource: 'thread' | 'global' | 'default';
    updatedAt: string | null;
    globalPrompt: string;
    globalPromptSource: 'settings' | 'default';
    defaultPrompt: string;
    maxPromptChars: number;
    runtimeAppendix: string;
  };
};

export type AssistantArtifactSummary = {
  path: string;
  size: number;
  updatedAt: string;
  revision: string;
  mimeType?: string;
  binary?: boolean;
};

export type AssistantArtifactFile = AssistantArtifactSummary & {
  content: string;
  contentBase64?: string;
};

export type AssistantAttachmentPayload = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
  disposition?: 'artifact' | 'prompt';
};

export type AssistantAttachmentSource = 'file' | 'paste';
export type AssistantDraftImageAttachment = Extract<DraftChatAttachment, { kind: 'image' }> & {
  source: AssistantAttachmentSource;
};
export type AssistantDraftTextAttachment = Extract<DraftChatAttachment, { kind: 'text' }> & {
  source: AssistantAttachmentSource;
};
export type AssistantDraftFileAttachment = {
  kind: 'file';
  id: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  source: 'file';
};
export type AssistantDraftAttachment =
  | AssistantDraftImageAttachment
  | AssistantDraftTextAttachment
  | AssistantDraftFileAttachment;
export type AssistantDroneReference = { id: string; name: string };
