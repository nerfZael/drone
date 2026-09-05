import type {
  MobileDroneAgentId,
  MobileDroneApprovalPolicy,
  MobileDroneAgentPermissionMode,
  MobileDroneCreateRuntime,
} from '../drones/NewDroneScreen';

export type MobileDictationDroneDestination =
  | 'current-chat'
  | 'root-drone'
  | 'group-drone'
  | 'new-chat'
  | 'clone-chat';

/** Drone destinations plus the on-device Companion, which takes the text as if it were spoken. */
export type MobileDictationDestination = MobileDictationDroneDestination | 'companion';

export type MobileDictationChatTarget = {
  destination: 'current-chat' | 'new-chat' | 'clone-chat';
  deviceId: string;
  droneId: string;
  droneName: string;
  chatName: string;
  chatNames: string[];
  label: string;
};

export type MobileDictationDroneTarget = {
  destination: 'root-drone' | 'group-drone';
  deviceId: string;
  repoPath: string;
  group: string;
  runtime: MobileDroneCreateRuntime;
  agent: MobileDroneAgentId;
  agentPermissionMode: MobileDroneAgentPermissionMode;
  approvalPolicy: MobileDroneApprovalPolicy;
  provider: string;
  model: string;
  reasoning: string;
  label: string;
};

export type MobileDictationTarget = MobileDictationChatTarget | MobileDictationDroneTarget;

export type MobileDictationTargetResult =
  | { ok: true; target: MobileDictationTarget }
  | { ok: false; error: string };

export type MobileDictationSendResult = { ok: true } | { ok: false; error: string };
