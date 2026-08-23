import type { AppConfirmationOptions } from '../../ui/AppConfirmDialog';
import type { DroneDeleteMode } from './settings-types';

export type DeleteDroneChatOptions = {
  confirmed?: boolean;
};

export function buildSidebarChatDeleteConfirmation({
  chatNames,
  droneLabel: droneLabelRaw,
  deleteMode,
  defaultChatKept = false,
}: {
  chatNames: readonly string[];
  droneLabel: string;
  deleteMode: DroneDeleteMode;
  defaultChatKept?: boolean;
}): AppConfirmationOptions {
  const count = chatNames.length;
  const droneLabel = String(droneLabelRaw ?? '').trim() || 'this drone';
  const archive = deleteMode === 'archive';
  const action = archive ? 'Archive' : 'Delete';
  const subject = count === 1 ? `chat “${chatNames[0]}”` : `${count} selected chats`;
  const recovery = archive
    ? ' You can restore archived chats from Settings > Archive before they auto-delete.'
    : '';
  const defaultNotice = defaultChatKept ? ' The default chat will be kept.' : '';

  return {
    title: `${action} ${count === 1 ? 'chat' : `${count} chats`}?`,
    message: `${action} ${subject} from “${droneLabel}”?${recovery}${defaultNotice}`,
    confirmLabel: count === 1 ? `${action} chat` : `${action} chats`,
    destructive: true,
  };
}
