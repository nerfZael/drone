import type { AssistantMessage } from './assistant-message-types.js';
import type { ChatQueueAction } from './chat-queue-actions.js';

export type NativeAgentProviderId = 'openai' | 'gemini' | 'codex';
export type NativeAgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type NativeChatStatus = 'idle' | 'running' | 'waiting_for_approval' | 'error';
export type NativePromptDeliveryMode = 'queue' | 'asap';
export type AgentPermissionMode = 'read' | 'write' | 'execute';
export type AgentApprovalPolicy = 'ask' | 'none';

export type NativeChatAccessScope = {
  readMode: 'all' | 'selected';
  writeMode: 'all' | 'selected';
  executeMode: 'all' | 'selected';
  /** Legacy scopes omit this; omission means enabled. */
  changeRequestCreate?: boolean;
  /** Legacy scopes omit this; omission means disabled. */
  changeRequestMerge?: boolean;
  droneIds: string[];
  updatedAt: string;
};

export type NativeAgentWorkspaceSummary = {
  id: string;
  label: string;
  kind: 'drone' | 'artifacts';
  description: string;
  capabilities: Array<'read' | 'write' | 'execute'>;
};

export type NativeQueuedPrompt = {
  id: string;
  prompt: string;
  promptImages: Array<{ type: 'image'; data: string; mimeType: string }>;
  imageCount: number;
  createdAt: string;
  deliveryMode?: NativePromptDeliveryMode;
  status: 'queued' | 'running' | 'failed';
  error: string | null;
  action?: ChatQueueAction;
};

export type NativeChatThread = {
  id: string;
  ownerDroneId?: string;
  ownerChatName?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: NativeAgentProviderId;
  thinkingLevel: NativeAgentThinkingLevel;
  systemPrompt: string;
  systemPromptUpdatedAt: string | null;
  enabledTools: string[];
  /** Missing only on chats created before workspace access became configurable. */
  enabledWorkspaceIds?: string[];
  accessScope: NativeChatAccessScope;
  agentPermissionMode: AgentPermissionMode;
  approvalPolicy: AgentApprovalPolicy;
  autoApprove: boolean;
  promptDeliveryMode: NativePromptDeliveryMode;
  queuedPrompts: NativeQueuedPrompt[];
  status: NativeChatStatus;
  error: string | null;
};

export type NativeChatApproval = {
  id: string;
  threadId: string;
  toolCallId: string;
  toolName: string;
  label: string;
  args: any;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
};

export type NativeAgentModelOption = {
  provider: NativeAgentProviderId;
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevel: NativeAgentThinkingLevel;
};

export type NativeAgentToolSummary = {
  name: string;
  label: string;
  description: string;
  category: 'context' | 'prompts' | 'files' | 'chats' | 'drones' | 'actions';
  group?: { kind: 'mcp'; id: string; label: string };
};

export type NativeAgentDefaultModel = {
  provider: NativeAgentProviderId;
  model: string;
  thinkingLevel: NativeAgentThinkingLevel;
};

export type NativeChatSnapshot = {
  ok: true;
  chatId: string;
  threads: NativeChatThread[];
  pendingApprovals: NativeChatApproval[];
  models: NativeAgentModelOption[];
  defaultModel: NativeAgentDefaultModel;
  defaultEnabledTools: string[];
  availableTools: NativeAgentToolSummary[];
  availableWorkspaces: NativeAgentWorkspaceSummary[];
  accessScope: NativeChatAccessScope;
  streamingMessage?: AssistantMessage;
  streamingMessages?: AssistantMessage[];
};

export type NativeAgentDefaultSettings = Pick<
  NativeChatSnapshot,
  'ok' | 'models' | 'defaultModel' | 'defaultEnabledTools'
>;
