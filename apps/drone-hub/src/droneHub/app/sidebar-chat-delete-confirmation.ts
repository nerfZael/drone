import type { AppConfirmationOptions } from '../../ui/AppConfirmDialog';
import type { DroneDeleteMode } from './settings-types';

export type DeleteDroneChatOptions = {
  confirmed?: boolean;
};

export function buildSidebarChatDeleteConfirmation({
  chatNames,
  droneLabel: droneLabelRaw,
  deleteMode,
  draftChatNames = [],
  defaultChatKept = false,
}: {
  chatNames: readonly string[];
  droneLabel: string;
  deleteMode: DroneDeleteMode;
  draftChatNames?: readonly string[];
  defaultChatKept?: boolean;
}): AppConfirmationOptions {
  const count = chatNames.length;
  const droneLabel = String(droneLabelRaw ?? '').trim() || 'this drone';
  const draftNameSet = new Set(draftChatNames);
  const draftCount = chatNames.filter((chatName) => draftNameSet.has(chatName)).length;
  const archiveCount = deleteMode === 'archive' ? count - draftCount : 0;
  const mixedDisposition = archiveCount > 0 && draftCount > 0;
  const archive = archiveCount > 0 && draftCount === 0;
  const action = archive ? 'Archive' : 'Delete';
  const subject = count === 1 ? `chat “${chatNames[0]}”` : `${count} selected chats`;
  const recovery = archiveCount > 0
    ? ' You can restore archived chats from Settings > Archive before they auto-delete.'
    : '';
  const defaultNotice = defaultChatKept ? ' The default chat will be kept.' : '';

  if (mixedDisposition) {
    const archivedLabel = `${archiveCount} chat${archiveCount === 1 ? '' : 's'}`;
    const deletedLabel = `${draftCount} draft chat${draftCount === 1 ? '' : 's'}`;
    return {
      title: `Archive and delete ${count} chats?`,
      message: `Archive ${archivedLabel} and permanently delete ${deletedLabel} from “${droneLabel}”?${recovery}${defaultNotice}`,
      confirmLabel: 'Archive and delete',
      destructive: true,
    };
  }

  return {
    title: `${action} ${count === 1 ? 'chat' : `${count} chats`}?`,
    message: `${action} ${subject} from “${droneLabel}”?${recovery}${defaultNotice}`,
    confirmLabel: count === 1 ? `${action} chat` : `${action} chats`,
    destructive: true,
  };
}

export function buildSidebarChatGroupDeleteConfirmation({
  chatCount,
  groupLabel: groupLabelRaw,
  droneLabel: droneLabelRaw,
  deleteMode,
  draftChatCount = 0,
  defaultChatKept = false,
}: {
  chatCount: number;
  groupLabel: string;
  droneLabel: string;
  deleteMode: DroneDeleteMode;
  draftChatCount?: number;
  defaultChatKept?: boolean;
}): AppConfirmationOptions {
  const count = Number.isFinite(chatCount) ? Math.max(0, Math.floor(chatCount)) : 0;
  const drafts = Number.isFinite(draftChatCount)
    ? Math.min(count, Math.max(0, Math.floor(draftChatCount)))
    : 0;
  const groupLabel = String(groupLabelRaw ?? '').trim() || 'this group';
  const droneLabel = String(droneLabelRaw ?? '').trim() || 'this drone';
  const archiveCount = deleteMode === 'archive' ? count - drafts : 0;
  const mixedDisposition = archiveCount > 0 && drafts > 0;
  const archive = archiveCount > 0 && drafts === 0;
  const action = archive ? 'Archive' : 'Delete';
  const countText = count === 1 ? 'the 1 chat' : `all ${count} chats`;
  const recovery = archiveCount > 0
    ? ' You can restore archived chats from Settings > Archive before they auto-delete.'
    : '';
  const defaultNotice = defaultChatKept ? ' The default chat will be kept.' : '';

  if (mixedDisposition) {
    const archivedLabel = `${archiveCount} chat${archiveCount === 1 ? '' : 's'}`;
    const deletedLabel = `${drafts} draft chat${drafts === 1 ? '' : 's'}`;
    return {
      title: `Archive and delete chats in “${groupLabel}”?`,
      message: `Archive ${archivedLabel} and permanently delete ${deletedLabel} in this group and its subgroups from “${droneLabel}”?${recovery} The group and its subgroups are not deleted.${defaultNotice}`,
      confirmLabel: 'Archive and delete',
      destructive: true,
    };
  }

  return {
    title: `${action} chats in “${groupLabel}”?`,
    message: `${action} ${countText} in this group and its subgroups from “${droneLabel}”?${recovery} The group and its subgroups are not deleted.${defaultNotice}`,
    confirmLabel: `${action} chats`,
    destructive: true,
  };
}
