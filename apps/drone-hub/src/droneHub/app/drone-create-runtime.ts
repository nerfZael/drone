import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';

export type CreateRuntime = 'container' | 'host';

export function runtimeSupportsCustomAgents(runtime: CreateRuntime): boolean {
  return runtime !== 'host';
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
  runtime: CreateRuntime;
  pullHostBranchBeforeCreate: boolean;
  seedAgent: ChatAgentConfig | null;
  seedModel?: string | null;
  prompt?: string | null;
};

export function buildDraftDroneCreatePayload({
  name,
  group,
  repoPath,
  runtime,
  pullHostBranchBeforeCreate,
  seedAgent,
  seedModel,
  prompt,
}: BuildDraftDroneCreatePayloadArgs) {
  const trimmedName = String(name ?? '').trim();
  const trimmedGroup = String(group ?? '').trim();
  const trimmedRepoPath = String(repoPath ?? '').trim();
  const trimmedPrompt = String(prompt ?? '').trim();
  const trimmedModel = String(seedModel ?? '').trim();
  return {
    ...(trimmedName ? { name: trimmedName } : {}),
    ...(trimmedGroup ? { group: trimmedGroup } : {}),
    ...(trimmedRepoPath ? { repoPath: trimmedRepoPath } : {}),
    runtime,
    pullHostBranchBeforeCreate,
    seedChat: 'default',
    ...(seedAgent ? { seedAgent } : {}),
    ...(trimmedModel ? { seedModel: trimmedModel } : {}),
    ...(trimmedPrompt ? { seedPrompt: trimmedPrompt } : {}),
  };
}
