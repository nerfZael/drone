import type {
  MobileDroneAgentId,
  MobileDroneApprovalPolicy,
  MobileDroneAgentPermissionMode,
} from '../drones/NewDroneScreen';
import type { MobileDroneSummary } from '../drones/drone-sidebar-model';
import type {
  MobileDictationDestination,
  MobileDictationTargetResult,
} from './mobile-dictation-types';

export function resolveMobileDictationTarget(input: {
  destination: MobileDictationDestination;
  deviceId: string;
  targetReachable: boolean;
  selectedDrone: MobileDroneSummary | null;
  chatName: string;
  agent: MobileDroneAgentId | null;
  agentPermissionMode: MobileDroneAgentPermissionMode;
  approvalPolicy: MobileDroneApprovalPolicy;
  provider: string;
  model: string;
  reasoning: string;
}): MobileDictationTargetResult {
  if (!input.targetReachable) {
    return { ok: false, error: 'The selected Drone Hub device is offline.' };
  }
  const drone = input.selectedDrone;
  if (!drone) {
    return { ok: false, error: 'Open a drone chat before using this destination.' };
  }

  if (input.destination === 'root-drone' || input.destination === 'group-drone') {
    const group = input.destination === 'group-drone' ? String(drone.group ?? '').trim() : '';
    return {
      ok: true,
      target: {
        destination: input.destination,
        deviceId: input.deviceId,
        repoPath: String(drone.repoPath ?? '').trim(),
        group,
        runtime: drone.runtime === 'host' ? 'host' : 'container',
        agent: input.agent ?? 'native',
        agentPermissionMode: input.agentPermissionMode,
        approvalPolicy: input.approvalPolicy,
        provider: input.provider,
        model: input.model,
        reasoning: input.reasoning,
        label:
          input.destination === 'root-drone'
            ? 'new root drone'
            : group
              ? `new drone in ${group}`
              : 'new ungrouped drone',
      },
    };
  }

  const chatName = String(input.chatName ?? '').trim() || 'default';
  return {
    ok: true,
    target: {
      destination: input.destination,
      deviceId: input.deviceId,
      droneId: drone.id,
      droneName: drone.name,
      chatName,
      chatNames: [...drone.chats],
      label:
        input.destination === 'current-chat'
          ? `${drone.name} / ${chatName}`
          : input.destination === 'new-chat'
            ? `new chat in ${drone.name}`
            : `clone of ${drone.name} / ${chatName}`,
    },
  };
}
