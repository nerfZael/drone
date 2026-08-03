import type {
  MobileDroneAgentId,
  MobileDroneApprovalPolicy,
  MobileDroneAgentPermissionMode,
  MobileDroneCreateDefaults,
  MobileDroneCreatePayload,
} from './NewDroneScreen';

export type MobileDroneCreatePreferences = {
  mode: 'with-chat' | 'without-chat';
  runtime: 'container' | 'host';
  draft: boolean;
  persistVolume: boolean;
  agent: MobileDroneAgentId;
  agentPermissionMode: MobileDroneAgentPermissionMode;
  approvalPolicy: MobileDroneApprovalPolicy;
  model: string;
  provider: string;
  reasoning: string;
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
};

export type MobileDroneCreatePreferenceSelection = MobileDroneCreatePreferences;

const AGENT_IDS = new Set<MobileDroneAgentId>([
  'native',
  'cursor',
  'codex',
  'claude',
  'opencode',
  'pi',
  'blip',
]);

function trimmed(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeMobileDroneCreatePreferences(
  value: unknown,
): MobileDroneCreatePreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<MobileDroneCreatePreferences>;
  const agent = AGENT_IDS.has(candidate.agent as MobileDroneAgentId)
    ? (candidate.agent as MobileDroneAgentId)
    : 'native';
  return {
    mode: candidate.mode === 'without-chat' ? 'without-chat' : 'with-chat',
    runtime: candidate.runtime === 'host' ? 'host' : 'container',
    draft: candidate.draft === true,
    persistVolume: candidate.persistVolume === true,
    agent,
    agentPermissionMode:
      candidate.agentPermissionMode === 'read-only' ||
      candidate.agentPermissionMode === 'workspace-write'
        ? candidate.agentPermissionMode
        : 'full-access',
    approvalPolicy:
      candidate.approvalPolicy === 'agent-decides' || candidate.approvalPolicy === 'never'
        ? candidate.approvalPolicy
        : 'ask',
    model: trimmed(candidate.model),
    provider: trimmed(candidate.provider),
    reasoning: trimmed(candidate.reasoning),
    repoBranchSource: candidate.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(candidate.repoCreateRemoteBranch),
  };
}

export function mobileDroneCreatePreferencesFromPayload(
  payload: MobileDroneCreatePayload,
): MobileDroneCreatePreferences {
  const seedAgent = payload.seedAgent;
  const agent: MobileDroneAgentId =
    seedAgent?.kind === 'builtin' ? seedAgent.id : 'native';
  return {
    mode: seedAgent ? 'with-chat' : 'without-chat',
    runtime: payload.runtime === 'host' ? 'host' : 'container',
    draft: payload.draft === true,
    persistVolume: payload.runtime === 'container' && payload.persistVolume === true,
    agent,
    agentPermissionMode:
      payload.seedAgentPermissionMode === 'read-only' ||
      payload.seedAgentPermissionMode === 'workspace-write'
        ? payload.seedAgentPermissionMode
        : 'full-access',
    approvalPolicy:
      payload.seedApprovalPolicy === 'agent-decides' || payload.seedApprovalPolicy === 'never'
        ? payload.seedApprovalPolicy
        : 'ask',
    model: trimmed(payload.seedModel),
    provider: trimmed(payload.seedProvider),
    reasoning: trimmed(payload.seedReasoning),
    repoBranchSource: payload.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(payload.remoteBranch),
  };
}

export function mobileDroneCreatePreferencesFromSelection(
  selection: MobileDroneCreatePreferenceSelection,
): MobileDroneCreatePreferences {
  return normalizeMobileDroneCreatePreferences(selection)!;
}

export function resolveMobileDroneCreateDefaults({
  remembered,
  repoPath,
  overrides,
}: {
  remembered: MobileDroneCreatePreferences | null;
  repoPath?: string | null;
  overrides?: MobileDroneCreateDefaults | null;
}): MobileDroneCreateDefaults {
  return {
    ...(remembered ?? {}),
    repoPath: trimmed(overrides?.repoPath ?? repoPath),
    ...(overrides ?? {}),
  };
}
