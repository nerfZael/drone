import type {
  NativeAgentModelOption,
  NativeAgentThinkingLevel,
  NativeAgentToolSummary,
} from '@drone/assistant-chat';

export type AssistantThinkingLevel = NativeAgentThinkingLevel;

export type AssistantDroneSummary = {
  id: string;
  name: string;
  group: string | null;
  runtime: string;
  repoPath: string;
  status: string;
  chats: string[];
  busy?: boolean;
  busyChats?: string[];
};

export type AssistantMessageDroneResult = {
  promptId: string;
  pendingState?: string | null;
  blockedByAutomation?: boolean;
};

export type AssistantCreateDroneResult = {
  id: string;
  name: string;
  runtime: string;
  phase: string;
  request: any;
};

export type AssistantCreateChatResult = {
  droneId: string;
  droneName: string;
  chatName: string;
  chats: string[];
};

export type AssistantSetDroneGroupResult = {
  group: string | null;
  moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
  rejected: Array<{ id: string; error: string }>;
  total: number;
};

export type AssistantRenameDronesResult = {
  renamed: Array<{ id: string; oldName: string; newName: string; renamed: boolean }>;
  rejected: Array<{ id: string; oldName?: string | null; newName: string; error: string }>;
  total: number;
};

export type AssistantCreateGroupResult = {
  ok: true;
  group: string;
  created: boolean;
  createdAt?: string | null;
  groupOrder?: unknown;
};

export type AssistantSetDroneGroupsResult = {
  assignments: Array<{
    group: string | null;
    droneIds: string[];
    result: AssistantSetDroneGroupResult;
  }>;
  moved: AssistantSetDroneGroupResult['moved'];
  rejected: AssistantSetDroneGroupResult['rejected'];
  total: number;
};

export type AssistantReorderDronesResult = {
  ok: true;
  group: string;
  drones: Array<{ id: string; name: string }>;
  sidebarDroneOrder?: string[];
  sidebarNodeOrder?: string[];
};

export type AssistantUiAction =
  | { type: 'open_drone_chat'; droneId: string; droneIds: string[]; chatName: string; at: string }
  | { type: 'highlight_drones'; droneIds: string[]; durationMs: number; at: string }
  | { type: 'open_whiteboard'; whiteboardId: string; at: string }
  | { type: 'close_whiteboard'; at: string }
  | { type: 'reload_ui_preferences'; at: string };

export type AssistantChangeEvent = {
  type: 'assistant_changed';
  sequence: number;
  reason: string;
  threadId?: string;
  uiAction?: AssistantUiAction;
  at: string;
};

export type AssistantChatIdleWaitMode = 'all' | 'any';
export type AssistantChatIdleTarget = { droneId: string; chatName: string };
export type AssistantChatIdleStatus = {
  droneId: string;
  chatName: string;
  idle: boolean;
  reason:
    | 'no_messages'
    | 'active_user_messages'
    | 'latest_agent_message'
    | 'latest_user_failed'
    | 'latest_user_message';
  activeUserMessages: number;
  queuedUserMessages: number;
  failedUserMessages: number;
  latest: null | {
    id: string;
    role: 'user' | 'agent';
    status: 'queued' | 'sending' | 'sent' | 'completed' | 'failed';
    at: string;
    text: string;
    turnId?: string;
  };
};

export type AssistantChatIdleWaitResult = {
  ok: boolean;
  timedOut: boolean;
  mode: AssistantChatIdleWaitMode;
  elapsedMs: number;
  timeoutMs: number;
  idleForMs: number;
  targets: AssistantChatIdleStatus[];
};

export type AssistantModelOption = NativeAgentModelOption;
export type AssistantToolSummary = NativeAgentToolSummary;

export type AssistantSystemPromptSettings = {
  ok: true;
  assistantSystemPrompt: PromptSetting;
};
type PromptSetting = {
  prompt: string;
  promptSource: 'settings' | 'default';
  updatedAt: string | null;
  defaultPrompt: string;
  maxPromptChars: number;
  runtimeAppendix: string;
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
