import type { ChatAgentConfig } from '../../domain';
import type { PendingPrompt } from '../types';
import type { RepoPullConflict } from './helpers';

export type ChatModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
};

export type TldrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: string }
  | { status: 'error'; error: string };

export type AppView = 'workspace' | 'settings';

export type StartupSeedState = {
  droneName: string;
  chatName: string;
  agent: ChatAgentConfig | null;
  model: string | null;
  prompt: string;
  at: string;
};

export type DraftChatState = {
  // If set, this is the (optimistic) id/name of the drone being created for this draft chat.
  droneId: string;
  droneName: string;
  prompt: PendingPrompt | null;
};

export type DroneErrorModalState = {
  droneId: string;
  droneName: string;
  message: string;
  conflict: RepoPullConflict;
};
