import type { DraftChatAttachment } from '../chat/chat-input-attachments';

export type AssistantThreadStatus =
  | 'idle'
  | 'running'
  | 'waiting_for_approval'
  | 'waiting_for_chats_idle'
  | 'error';

export type AssistantMessage = {
  role: 'user' | 'assistant' | 'toolResult';
  content?:
    | string
    | Array<{
        type: string;
        text?: string;
        thinking?: string;
        name?: string;
        arguments?: any;
        id?: string;
        data?: string;
        mimeType?: string;
      }>;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  errorMessage?: string;
};

export type AssistantProviderId = 'openai' | 'gemini' | 'codex';
export type AssistantPromptDeliveryMode = 'queue' | 'asap';
export type AssistantPanelMode = 'normal' | 'voice';
export type AssistantSystemPromptKind = 'normal' | 'voice';

export type AssistantRunModel = {
  provider: AssistantProviderId;
  model: string;
  thinkingLevel: string;
  promptId: string;
  startedAt: string;
};

export type AssistantChatIdleSubscription = {
  id: string;
  threadId: string;
  mode?: 'all' | 'any';
  targets: Array<{ droneId: string; chatName: string }>;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'fired' | 'cancelled' | 'expired';
};

export type AssistantAccessScope = {
  readMode: 'all' | 'selected';
  writeMode: 'all' | 'selected';
  droneIds: string[];
  updatedAt: string;
};

export type AssistantThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  voiceEnabled?: boolean;
  voiceEnabledAt?: string | null;
  model: string;
  provider: AssistantProviderId;
  thinkingLevel: string;
  systemPrompt?: string;
  systemPromptUpdatedAt?: string | null;
  enabledTools?: string[];
  accessScope: AssistantAccessScope;
  autoApprove: boolean;
  promptDeliveryMode: AssistantPromptDeliveryMode;
  messageCount?: number;
  messages: AssistantMessage[];
  status: AssistantThreadStatus;
  error: string | null;
};

export type AssistantApproval = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  label: string;
  args: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

export type AssistantModelOption = {
  provider: AssistantProviderId;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: string;
};

export type AssistantToolSummary = {
  name: string;
  label: string;
  description: string;
  category: 'context' | 'prompts' | 'files' | 'chats' | 'drones' | 'actions';
};

export type AssistantScopeUpdateResult = { ok: true; accessScope?: AssistantAccessScope };
export type AssistantScopeMode = 'all' | 'selected';
export type AssistantScopeDrone = { id: string; name: string };
export type AssistantScopeDraft = {
  readMode: AssistantScopeMode;
  writeMode: AssistantScopeMode;
  drones: AssistantScopeDrone[];
};
export type PendingAssistantScopeSave = {
  requestId: number;
  threadId: string;
  key: string;
  promise: Promise<boolean>;
};

export type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
  pendingApprovals: AssistantApproval[];
  chatIdleSubscriptions?: AssistantChatIdleSubscription[];
  models: AssistantModelOption[];
  defaultModel: { provider: AssistantProviderId; model: string };
  availableTools?: AssistantToolSummary[];
  accessScope?: AssistantAccessScope;
  runningModels?: Record<string, AssistantRunModel>;
  streamingMessage?: AssistantMessage;
  streamingMessages?: AssistantMessage[];
};

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
  assistantVoiceSystemPrompt: {
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

export type AssistantOverviewPromptSettings = {
  ok: true;
  assistantOverviewPrompt: {
    prompt: string;
    promptSource: 'settings' | 'default';
    updatedAt: string | null;
    defaultPrompt: string;
    maxPromptChars: number;
  };
};

export type AssistantThreadOverviewResult = {
  ok: true;
  threadId: string;
  markdown: string;
  generatedAt: string;
  inputFingerprint: string;
  promptFingerprint: string;
  provider: AssistantProviderId;
  model: string;
  cached: boolean;
  inputReused: boolean;
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
export type AssistantDroneNameMap = Record<string, string>;
