import type {
  AgentOptions,
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { PermissionMode, ToolProfile } from "@blip/tools";
import type { CompactionSettings } from "./compaction.js";
import type { SessionRepository } from "./session-repository.js";
import type { BlipRuntimeEvent, BlipSessionState } from "./types.js";

export type BlipEventSink = (event: BlipRuntimeEvent) => Promise<void> | void;

export type BlipPromptInput =
  | string
  | AgentMessage
  | {
      text: string;
      images?: ImageContent[];
    };

export interface BlipSessionContext {
  session: BlipSessionState;
  repository: SessionRepository;
  model: Model<any>;
  workspaceRoot: string;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
}

export interface BlipToolProvider {
  id: string;
  load(context: BlipSessionContext): Promise<AgentTool<any>[]> | AgentTool<any>[];
  promptSections?(context: BlipSessionContext): Promise<string[]> | string[];
}

export type BlipPromptProvider = (context: BlipSessionContext) => Promise<string> | string;

export type BlipToolPreflightDecision =
  | { status: "allow" }
  | { status: "deny"; reason: string };

export interface BlipToolPreflightRequest {
  session: BlipSessionState;
  tool: string;
  callId: string;
  args: unknown;
  signal?: AbortSignal;
}

export type BlipToolPreflight = (
  request: BlipToolPreflightRequest,
) => Promise<BlipToolPreflightDecision> | BlipToolPreflightDecision;

export interface BlipPromptLifecycleContext extends BlipSessionContext {
  prompt: AgentMessage;
}

export interface CreateBlipSessionOptions {
  workspaceRoot: string;
  model: Model<any>;
  permissionMode: PermissionMode;
  toolProfile: ToolProfile;
  sessionRepository: SessionRepository;
  sessionId?: string;
  forkSessionId?: string;
  continueLatest?: boolean;
  resumeLatest?: boolean;
  reasoning?: ThinkingLevel;
  tools?: AgentTool<any>[];
  toolProviders?: BlipToolProvider[];
  promptProvider?: BlipPromptProvider;
  transformContext?: AgentOptions["transformContext"];
  convertToLlm?: AgentOptions["convertToLlm"];
  onResponse?: AgentOptions["onResponse"];
  permissionPreflight?: BlipToolPreflight;
  eventSink?: BlipEventSink;
  compactionSettings?: CompactionSettings;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  beforePrompt?: (context: BlipPromptLifecycleContext) => Promise<void> | void;
  afterPrompt?: (context: BlipPromptLifecycleContext) => Promise<void> | void;
  processExitDiagnosticsDelayMs?: number;
}

export interface BlipSessionHandle {
  readonly state: BlipSessionState;
  readonly running: boolean;
  prompt(input: BlipPromptInput): Promise<BlipSessionState>;
  steer(input: BlipPromptInput): void;
  enqueue(input: BlipPromptInput): Promise<BlipSessionState>;
  compact(settings?: CompactionSettings): Promise<BlipSessionState>;
  delete(): Promise<void>;
  clearQueue(): void;
  abort(): void;
  waitForIdle(): Promise<void>;
  close(): void;
}
