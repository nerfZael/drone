import type {
  MobileDroneAgentId,
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
  model: string;
  provider: string;
  reasoning: string;
  repoBranchSource: 'host' | 'remote';
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
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
      candidate.agentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
    model: trimmed(candidate.model),
    provider: trimmed(candidate.provider),
    reasoning: trimmed(candidate.reasoning),
    repoBranchSource: candidate.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(candidate.repoCreateRemoteBranch),
    pullHostBranchBeforeCreate: candidate.pullHostBranchBeforeCreate === true,
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
      payload.seedAgentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
    model: trimmed(payload.seedModel),
    provider: trimmed(payload.seedProvider),
    reasoning: trimmed(payload.seedReasoning),
    repoBranchSource: payload.repoBranchSource === 'remote' ? 'remote' : 'host',
    repoCreateRemoteBranch: trimmed(payload.remoteBranch),
    pullHostBranchBeforeCreate: payload.pullHostBranchBeforeCreate === true,
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
