import type { VoiceApprovalSettings } from '../../server/src/voice-approval-settings.js';

export type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  admin: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
};

export type CreditLedgerKind = 'grant' | 'purchase' | 'usage' | 'refund' | 'adjustment';

export type CreditLedgerRecord = {
  id: string;
  userId: string;
  actorUserId: string | null;
  kind: CreditLedgerKind;
  amountMicrocredits: number;
  balanceAfterMicrocredits: number;
  reason: string;
  metadataJson: string | null;
  createdAt: string;
};

export type UserCreditSummary = {
  balanceMicrocredits: number;
  grantedMicrocredits: number;
  purchasedMicrocredits: number;
  spentMicrocredits: number;
  lastCreditAt: string | null;
};

export type PendingCreditGrantRecord = {
  id: string;
  normalizedEmail: string;
  email: string;
  actorUserId: string | null;
  amountMicrocredits: number;
  reason: string;
  metadataJson: string | null;
  claimedUserId: string | null;
  claimedLedgerId: string | null;
  createdAt: string;
  claimedAt: string | null;
};

export type AdminUserBillingSummary = {
  user: UserProfile;
  threadCount: number;
  assistantProfileCount: number;
  creditBalanceMicrocredits: number;
  creditsGrantedMicrocredits: number;
  creditsPurchasedMicrocredits: number;
  creditsSpentMicrocredits: number;
  lastCreditAt: string | null;
};

export type VoiceSettings = VoiceApprovalSettings & {
  speechPlaybackTarget: SpeechPlaybackTarget;
  assistantProfiles?: AssistantProfile[];
  updatedAt: string;
};

export type AssistantProfile = {
  id: string;
  userId: string;
  baseProfileId: string | null;
  name: string;
  wakePhrase: string;
  wakePhraseAliases: string[];
  ttsVoice: string;
  enabled: boolean;
  sortOrder: number;
  systemPrompt: string | null;
  enabledTools: string[] | null;
  defaultHandsFreeMode: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SpeechPlaybackTarget = 'auto' | 'web' | 'desktop' | 'android';

export type SpeechPlaybackStatus = {
  preferredTarget: SpeechPlaybackTarget;
  connectedTargets: Array<Exclude<SpeechPlaybackTarget, 'auto'>>;
  resolvedTarget: Exclude<SpeechPlaybackTarget, 'auto'> | null;
};

export type VoiceApprovalFormState = VoiceApprovalSettings;

export type DeviceRecord = {
  id: string;
  userId: string;
  deviceType: string;
  displayName: string;
  installationId: string | null;
  tokenHint: string;
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string | null;
};

export type PairingSessionRecord = {
  id: string;
  userId: string;
  deviceId: string;
  expiresAt: string;
  claimedAt: string | null;
  createdAt: string;
};

export type AndroidApkInfo = {
  available: boolean;
  platform: 'android';
  app: string;
  variant: string | null;
  versionCode: number | null;
  versionName: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
  updatePayload: string | null;
};

export type DesktopAppInfo = {
  available: boolean;
  platform: 'desktop';
  app: string;
  variant: string | null;
  fileName: string | null;
  size: number | null;
  builtAt: string | null;
  downloadUrl: string | null;
};

export type AndroidSetupInfo = {
  id: string;
  expiresAt: string;
  setupUrl: string;
};

export type LogRecord = {
  id: string;
  deviceId: string | null;
  source: string;
  level: string;
  message: string;
  detailsJson: string | null;
  createdAt: string;
};

export type AssistantThread = {
  id: string;
  userId?: string;
  title: string;
  source: string;
  deviceId: string | null;
  assistantProfileId?: string | null;
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  status?: 'idle' | 'running' | 'waiting_for_approval' | 'cancelled' | 'error';
  error?: string | null;
  voiceEnabled?: boolean;
  voiceMode?: 'standard' | 'realtime' | null;
  autoApprove?: boolean;
  handsFreeMode?: boolean;
  systemPrompt?: string | null;
  enabledTools?: string[];
  capabilities?: {
    artifacts: boolean;
    speech: boolean;
    approvals: boolean;
    externalCalls: boolean;
    futureIntegrations: boolean;
  };
  promptDeliveryMode?: 'queue' | 'asap';
  updatedAt: string;
  createdAt: string;
};

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant' | 'toolResult' | 'system';
  content: string;
  contentJson?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  isError?: boolean;
  spokenText: string | null;
  createdAt: string;
};

export type AssistantRunRecord = {
  id: string;
  threadId: string;
  status: 'idle' | 'running' | 'waiting_for_approval' | 'cancelled' | 'error';
  provider: string;
  model: string;
  thinkingLevel: string;
  prompt: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantQueuedPromptRecord = {
  id: string;
  threadId: string;
  prompt: string;
  provider: string;
  model: string;
  thinkingLevel: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

export type AssistantToolCallRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  toolName: string;
  status: string;
  argsJson: string;
  resultJson: string | null;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSkillRecord = {
  id: string;
  userId: string;
  slug: string;
  name: string;
  description: string;
  markdownBody: string;
  toolNames: string[];
  disableModelInvocation: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AssistantLoadedSkillView = Pick<AssistantSkillRecord, 'id' | 'slug' | 'name'>;

export type AssistantApprovalRecord = {
  id: string;
  threadId: string;
  runId: string | null;
  toolCallId: string;
  toolName: string;
  label: string;
  argsJson: string;
  args?: unknown;
  status: 'pending' | 'approved' | 'denied';
  requestedBy: string;
  resolvedBy: string | null;
  resultJson: string | null;
  failureReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AssistantArtifactRecord = {
  id: string;
  threadId: string;
  path: string;
  content: string;
  size: number;
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSettingsRecord = {
  userId: string;
  normalSystemPrompt: string;
  voiceSystemPrompt: string;
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: string;
  defaultEnabledTools: string[];
  updatedAt: string;
};

export type AssistantApiKeyView = {
  provider: 'openai' | 'exa' | 'groq';
  hasKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
};

export type AssistantToolSummary = {
  name: string;
  label: string;
  category: string;
  description: string;
  approval: 'never' | 'normal_threads' | 'always' | 'dynamic';
  sourceKind?: 'built_in' | 'extension' | 'mcp';
  sourceId?: string;
  sourceName?: string;
};

export type AssistantExtensionTargetKind = 'server' | 'device' | 'any_device';

export type AssistantExtensionToolManifest = {
  name: string;
  label: string;
  description: string;
  category?: string;
  inputSchema: Record<string, unknown>;
  approval?: 'never' | 'normal_threads' | 'always' | 'dynamic';
  supportedTargets: AssistantExtensionTargetKind[];
  defaultTarget: AssistantExtensionTargetKind;
};

export type AssistantExtensionManifest = {
  id: string;
  name: string;
  version: string;
  sourceKind?: 'extension' | 'mcp';
  description?: string;
  tools: AssistantExtensionToolManifest[];
};

export type AssistantExtensionManifestRecord = {
  userId: string;
  extensionId: string;
  name: string;
  version: string;
  description: string | null;
  manifest: AssistantExtensionManifest;
  updatedAt: string;
};

export type AssistantExtensionToolRoute = {
  userId: string;
  toolName: string;
  enabled: boolean;
  targetKind: AssistantExtensionTargetKind;
  targetDeviceId: string | null;
  updatedAt: string;
};

export type ExtensionBridgeConnection = {
  userId: string;
  deviceId: string;
  deviceType: string;
  displayName: string;
  manifests: AssistantExtensionManifest[];
  connectedAt: string;
  toolNames: string[];
};

export type AssistantExtensionsResponse = {
  ok: true;
  manifests: AssistantExtensionManifestRecord[];
  routes: AssistantExtensionToolRoute[];
  connectedDevices: ExtensionBridgeConnection[];
};

export type AssistantModelOption = {
  provider: string;
  id: string;
  name: string;
  thinkingLevel: string;
};

export type AssistantCodexConnection = {
  connected: boolean;
  accountId: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
};

export type AssistantThreadView = AssistantThread & {
  messages: AssistantMessage[];
  runs: AssistantRunRecord[];
  queuedPrompts: AssistantQueuedPromptRecord[];
  toolCalls: AssistantToolCallRecord[];
  artifactsCount: number;
  loadedSkills: AssistantLoadedSkillView[];
  executionTargets: AssistantExecutionTargetView[];
};

export type AssistantExecutionTargetView = {
  slot: string;
  targetKind: string;
  targetDeviceId: string | null;
  targetDeviceName: string | null;
  targetDeviceMissing: boolean;
  targetDeviceRevoked: boolean;
  updatedAt: string;
};

export type AssistantSnapshot = {
  ok: true;
  userId: string;
  activeThreadId: string | null;
  threads: AssistantThreadView[];
  pendingApprovals: AssistantApprovalRecord[];
  models: AssistantModelOption[];
  availableTools: AssistantToolSummary[];
  skills: AssistantSkillRecord[];
  assistantSettings: AssistantSettingsRecord;
  assistantProfiles: AssistantProfile[];
  apiKeys: Record<'openai' | 'exa' | 'groq', AssistantApiKeyView>;
  codexConnection: AssistantCodexConnection;
  runningModels: Record<string, { provider: string; model: string; thinkingLevel: string; runId: string }>;
};

export type TranscriptRecord = {
  id: string;
  voiceSessionId: string;
  assistantThreadId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  text: string;
  final: boolean;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  createdAt: string;
};

export type VoiceRecordingRecord = {
  id: string;
  voiceSessionId: string;
  assistantThreadId: string;
  userId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  sampleRateHz: number;
  channels: number;
  transcriptId: string | null;
  transcriptText: string | null;
  transcriptFinal: boolean;
  transcriptCreatedAt: string | null;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  createdAt: string;
};

export type TranscriptSessionGroup = {
  voiceSessionId: string;
  assistantThreadId: string;
  deviceId: string;
  deviceName: string;
  mode: string;
  sessionStartedAt: string;
  sessionEndedAt: string | null;
  transcripts: TranscriptRecord[];
};

export type ClientStatusRecord = {
  deviceId: string;
  deviceType: string;
  displayName: string;
  mode: string;
  status: string;
  microphone: string;
  protocolVersion: number | null;
  appVersion: string | null;
  lastError: string | null;
  reportedAt: string;
  updatedAt: string;
};

export type DashboardData = {
  ok: true;
  authMode: 'clerk' | 'dev' | 'webview';
  user: UserProfile;
  settings: VoiceSettings;
  speechPlayback?: SpeechPlaybackStatus;
  assistantSettings?: AssistantSettingsRecord;
  assistantProfiles?: AssistantProfile[];
  threads: AssistantThread[];
  assistantApprovals?: AssistantApprovalRecord[];
  logs: LogRecord[];
  transcripts: TranscriptRecord[];
  clientStatuses: ClientStatusRecord[];
  approvalCodes: { id: string; code: string; source: string; createdAt: string }[];
  devices: DeviceRecord[];
  pairingSessions: PairingSessionRecord[];
  credits: UserCreditSummary;
  adminUsers: AdminUserBillingSummary[];
  adminPendingCreditGrants: PendingCreditGrantRecord[];
  adminDevices: DeviceRecord[];
  adminClientStatuses: ClientStatusRecord[];
  stats: { threadCount: number; deviceCount: number; logCount: number; transcriptCount: number };
  dbPath: string;
};

export type ApiClient = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  stream(path: string, init?: RequestInit): Promise<Response>;
  upload(path: string, init: RequestInit, onProgress?: (progress: { loaded: number; total: number | null }) => void): Promise<Response>;
};

export type WebRecordingTranscriptionResponse = {
  ok: true;
  text: string;
  provider: 'groq' | 'fallback';
  credentialSource: 'platform_groq_key' | 'user_groq_key' | null;
  model: string | null;
  audioDurationMs: number;
  sampleRateHz: number;
  channels: number;
};

export type DevUser = {
  email: string;
  name: string;
  admin: boolean;
};

export type DashboardView = 'threads' | 'settings' | 'admin';

export type DesktopVoskStatus = {
  available: boolean;
  modelPath?: string;
  error?: string;
};

export type DesktopVoskText = {
  text: string;
  final?: boolean;
};
