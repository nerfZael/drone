import type { ChatAgentConfig } from '../../domain';
import { buildDraftDroneCreatePayload, type RepoBranchSelectionState, type RepoBranchSourceMode } from '../app/drone-create-runtime';

export type DroneHubTaskSpawnMode = 'spawn' | 'clone';

type DroneHubTaskSourceContext = {
  group?: string | null;
  repoPath?: string | null;
};

type DroneHubTaskRepoDefaults = {
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
};

export function buildDroneHubTaskQueueSpec(args: {
  mode: DroneHubTaskSpawnMode;
  requestedName: string;
  taskDescription: string;
  sourceDroneId: string;
  sourceContext: DroneHubTaskSourceContext;
  seedAgent: ChatAgentConfig | null;
  seedModel: string | null;
  repoDefaults: DroneHubTaskRepoDefaults;
}): { name: string } & Record<string, unknown> {
  const requestedName = String(args.requestedName ?? '').trim();
  const taskDescription = String(args.taskDescription ?? '').trim();
  const sourceDroneId = String(args.sourceDroneId ?? '').trim();
  const group = String(args.sourceContext?.group ?? '').trim();
  const repoPath = String(args.sourceContext?.repoPath ?? '').trim();
  const seedModel = String(args.seedModel ?? '').trim() || null;

  if (args.mode === 'clone') {
    return {
      name: requestedName,
      runtime: 'container',
      ...(group ? { group } : {}),
      ...(repoPath ? { repoPath } : {}),
      fleetParentId: sourceDroneId,
      cloneFrom: sourceDroneId,
      cloneChats: false,
      ...(args.seedAgent ? { seedAgent: args.seedAgent } : {}),
      ...(seedModel ? { seedModel } : {}),
      seedChat: 'default',
      seedPrompt: taskDescription,
    };
  }

  const repoBranchSelection: RepoBranchSelectionState = {
    repoBranchSource: repoPath ? args.repoDefaults.repoBranchSource : 'host',
    pullHostBranchBeforeCreate: args.repoDefaults.pullHostBranchBeforeCreate === true,
    remoteBranch:
      repoPath && args.repoDefaults.repoBranchSource === 'remote'
        ? String(args.repoDefaults.repoCreateRemoteBranch ?? '').trim()
        : '',
  };

  return {
    name: requestedName,
    ...buildDraftDroneCreatePayload({
      name: requestedName,
      ...(group ? { group } : {}),
      ...(repoPath ? { repoPath } : {}),
      fleetParentId: sourceDroneId,
      runtime: 'container',
      repoBranchSelection,
      seedAgent: args.seedAgent,
      seedModel,
      prompt: taskDescription,
    }),
  };
}
