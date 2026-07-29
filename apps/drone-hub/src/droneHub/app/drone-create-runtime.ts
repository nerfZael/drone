import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
} from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';

export type CreateRuntime = 'container' | 'host';
export type RepoBranchSourceMode = 'host' | 'remote';

export type RepoBranchSelectionState = {
  repoBranchSource: RepoBranchSourceMode;
  pullHostBranchBeforeCreate: boolean;
  remoteBranch?: string | null;
};

export function resolveAgentsMdOverrideForCreate({
  enabled,
  content,
  repoPath,
  runtime,
  isClone,
}: {
  enabled: boolean;
  content: string;
  repoPath?: string | null;
  runtime: CreateRuntime;
  isClone: boolean;
}): string | undefined {
  if (!enabled || isClone || runtime !== 'container' || !String(repoPath ?? '').trim()) {
    return undefined;
  }
  return String(content ?? '');
}

export function resolveAgentsMdLibraryFileIdForCreate({
  fileId,
  customOverrideEnabled,
  repoPath,
  runtime,
  isClone,
}: {
  fileId?: string | null;
  customOverrideEnabled: boolean;
  repoPath?: string | null;
  runtime: CreateRuntime;
  isClone: boolean;
}): string | undefined {
  const normalizedFileId = String(fileId ?? '').trim();
  if (
    !normalizedFileId ||
    customOverrideEnabled ||
    isClone ||
    runtime !== 'container' ||
    !String(repoPath ?? '').trim()
  ) {
    return undefined;
  }
  return normalizedFileId;
}

export async function materializeAgentsMdForCreate({
  customOverride,
  libraryFileId,
  loadLibraryFile,
}: {
  customOverride?: string;
  libraryFileId?: string;
  loadLibraryFile: (fileId: string) => Promise<string>;
}): Promise<string | undefined> {
  if (customOverride !== undefined) return customOverride;
  if (!libraryFileId) return undefined;
  return await loadLibraryFile(libraryFileId);
}

export function runtimeSupportsCustomAgents(runtime: CreateRuntime): boolean {
  return runtime !== 'host';
}

export function shouldAutoRenameDraftDrone({
  requested,
  name,
  createWithoutChat,
}: {
  requested?: boolean;
  name?: string | null;
  createWithoutChat: boolean;
}): boolean {
  if (createWithoutChat) return false;
  return requested ?? !String(name ?? '').trim();
}

export function filterSpawnAgentMenuEntriesForRuntime(
  runtime: CreateRuntime,
  entries: UiMenuSelectEntry[],
): UiMenuSelectEntry[] {
  if (runtimeSupportsCustomAgents(runtime)) return entries;
  const out: UiMenuSelectEntry[] = [];
  let pendingSeparator = false;
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      pendingSeparator = out.length > 0;
      continue;
    }
    if (entry.value.startsWith('custom:')) continue;
    if (pendingSeparator) {
      out.push({ kind: 'separator' });
      pendingSeparator = false;
    }
    out.push(entry);
  }
  return out;
}

type BuildDraftDroneCreatePayloadArgs = {
  name?: string | null;
  group?: string | null;
  repoPath?: string | null;
  fleetParentId?: string | null;
  repoSeedFromDroneId?: string | null;
  runtime: CreateRuntime;
  persistVolume?: boolean | null;
  repoBranchSelection: RepoBranchSelectionState;
  seedAgent: ChatAgentConfig | null;
  seedModel?: string | null;
  seedReasoning?: string | null;
  seedAgentPermissionMode?: AgentPermissionMode;
  agentsMd?: string;
  seedApprovalPolicy?: AgentApprovalPolicy;
  prompt?: string | null;
};

export function buildDraftDroneCreatePayload({
  name,
  group,
  repoPath,
  fleetParentId,
  repoSeedFromDroneId,
  runtime,
  persistVolume,
  repoBranchSelection,
  seedAgent,
  seedModel,
  seedReasoning,
  seedAgentPermissionMode,
  agentsMd,
  seedApprovalPolicy,
  prompt,
}: BuildDraftDroneCreatePayloadArgs) {
  const trimmedName = String(name ?? '').trim();
  const trimmedGroup = String(group ?? '').trim();
  const trimmedRepoPath = String(repoPath ?? '').trim();
  const trimmedFleetParentId = String(fleetParentId ?? '').trim();
  const trimmedRepoSeedFromDroneId = String(repoSeedFromDroneId ?? '').trim();
  const trimmedPrompt = String(prompt ?? '').trim();
  const trimmedModel = String(seedModel ?? '').trim();
  const trimmedReasoning = String(seedReasoning ?? '').trim();
  const repoBranchSource = repoBranchSelection.repoBranchSource;
  const remoteBranch = String(repoBranchSelection.remoteBranch ?? '').trim();
  const hasChatSeed = Boolean(seedAgent || trimmedModel || trimmedReasoning || trimmedPrompt);
  return {
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(trimmedGroup ? { group: trimmedGroup } : {}),
    ...(trimmedRepoPath ? { repoPath: trimmedRepoPath } : {}),
    ...(trimmedFleetParentId ? { fleetParentId: trimmedFleetParentId } : {}),
    ...(trimmedRepoSeedFromDroneId ? { repoSeedFromDroneId: trimmedRepoSeedFromDroneId } : {}),
    runtime,
    ...(runtime === 'container' && typeof persistVolume === 'boolean' ? { persistVolume } : {}),
    pullHostBranchBeforeCreate: repoBranchSelection.pullHostBranchBeforeCreate,
    repoBranchSource,
    ...(repoBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
    ...(agentsMd !== undefined ? { agentsMd } : {}),
    ...(hasChatSeed ? { seedChat: 'default' } : {}),
    ...(seedAgent ? { seedAgent } : {}),
    ...(trimmedModel ? { seedModel: trimmedModel } : {}),
    ...(trimmedReasoning ? { seedReasoning: trimmedReasoning } : {}),
    ...(seedAgentPermissionMode && seedAgentPermissionMode !== 'full-access'
      ? { seedAgentPermissionMode }
      : {}),
    ...(seedApprovalPolicy && seedApprovalPolicy !== 'ask' ? { seedApprovalPolicy } : {}),
    ...(trimmedPrompt ? { seedPrompt: trimmedPrompt } : {}),
    ...(trimmedPrompt ? { seedSubmittedAt: new Date().toISOString() } : {}),
  };
}
