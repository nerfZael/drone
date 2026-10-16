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
  sideChatCount = 0,
}: {
  chatNames: readonly string[];
  droneLabel: string;
  deleteMode: DroneDeleteMode;
  draftChatNames?: readonly string[];
  defaultChatKept?: boolean;
  /** Side chats of these chats, which go with them. */
  sideChatCount?: number;
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
  const sideChatNotice = sideChatNoticeText(sideChatCount, archiveCount > 0 ? 'archived' : 'deleted', count);

  if (mixedDisposition) {
    const archivedLabel = `${archiveCount} chat${archiveCount === 1 ? '' : 's'}`;
    const deletedLabel = `${draftCount} draft chat${draftCount === 1 ? '' : 's'}`;
    return {
      title: `Archive and delete ${count} chats?`,
      message: `Archive ${archivedLabel} and permanently delete ${deletedLabel} from “${droneLabel}”?${sideChatNotice}${recovery}${defaultNotice}`,
      confirmLabel: 'Archive and delete',
      destructive: true,
    };
  }

  return {
    title: `${action} ${count === 1 ? 'chat' : `${count} chats`}?`,
    message: `${action} ${subject} from “${droneLabel}”?${sideChatNotice}${recovery}${defaultNotice}`,
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
  sideChatCount = 0,
}: {
  chatCount: number;
  groupLabel: string;
  droneLabel: string;
  deleteMode: DroneDeleteMode;
  draftChatCount?: number;
  defaultChatKept?: boolean;
  /** Side chats of these chats, which go with them. */
  sideChatCount?: number;
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
  const sideChatNotice = sideChatNoticeText(sideChatCount, archiveCount > 0 ? 'archived' : 'deleted', count);

  if (mixedDisposition) {
    const archivedLabel = `${archiveCount} chat${archiveCount === 1 ? '' : 's'}`;
    const deletedLabel = `${drafts} draft chat${drafts === 1 ? '' : 's'}`;
    return {
      title: `Archive and delete chats in “${groupLabel}”?`,
      message: `Archive ${archivedLabel} and permanently delete ${deletedLabel} in this group and its subgroups from “${droneLabel}”?${sideChatNotice}${recovery} The group and its subgroups are not deleted.${defaultNotice}`,
      confirmLabel: 'Archive and delete',
      destructive: true,
    };
  }

  return {
    title: `${action} chats in “${groupLabel}”?`,
    message: `${action} ${countText} in this group and its subgroups from “${droneLabel}”?${sideChatNotice}${recovery} The group and its subgroups are not deleted.${defaultNotice}`,
    confirmLabel: `${action} chats`,
    destructive: true,
  };
}

/**
 * One question for every chat selected on a canvas, however many drones they
 * belong to. Default chats are never deleted this way; the message says so
 * when one was selected.
 */
export function buildCanvasChatDeleteConfirmation({
  targets,
  droneLabelById,
  deleteMode,
  isDraft,
  sideChatCount = 0,
}: {
  targets: ReadonlyArray<{ droneId: string; chatName: string }>;
  droneLabelById: (droneId: string) => string;
  deleteMode: DroneDeleteMode;
  isDraft: (droneId: string, chatName: string) => boolean;
  /** Side chats of the targets that are not targets themselves; they go with them. */
  sideChatCount?: number;
}): AppConfirmationOptions {
  const droneIds = [...new Set(targets.map((target) => target.droneId))];
  const chatNames = targets.map((target) => target.chatName);
  const draftChatNames = targets.filter((target) => isDraft(target.droneId, target.chatName)).map((target) => target.chatName);
  if (droneIds.length <= 1) {
    return buildSidebarChatDeleteConfirmation({
      chatNames,
      droneLabel: droneLabelById(droneIds[0] ?? ''),
      deleteMode,
      draftChatNames,
      sideChatCount,
    });
  }
  const count = chatNames.length;
  const draftCount = draftChatNames.length;
  const archiveCount = deleteMode === 'archive' ? count - draftCount : 0;
  const action = archiveCount > 0 && draftCount === 0 ? 'Archive' : 'Delete';
  const recovery = archiveCount > 0
    ? ' You can restore archived chats from Settings > Archive before they auto-delete.'
    : '';
  const sideChatNotice = sideChatNoticeText(sideChatCount, archiveCount > 0 ? 'archived' : 'deleted', count);
  if (archiveCount > 0 && draftCount > 0) {
    return {
      title: `Archive and delete ${count} chats?`,
      message: `Archive ${archiveCount} chat${archiveCount === 1 ? '' : 's'} and permanently delete ${draftCount} draft chat${draftCount === 1 ? '' : 's'} across ${droneIds.length} drones?${sideChatNotice}${recovery}`,
      confirmLabel: 'Archive and delete',
      destructive: true,
    };
  }
  return {
    title: `${action} ${count} chats?`,
    message: `${action} ${count} selected chats across ${droneIds.length} drones?${sideChatNotice}${recovery}`,
    confirmLabel: `${action} chats`,
    destructive: true,
  };
}

/**
 * A draft chat that nothing was sent to and nothing is typed in: deleting it loses nothing, so it
 * goes without a question.
 */
export function chatIsUntouchedDraft(input: {
  /** Listed as a draft by the hub, or just created here and not listed yet. */
  draft: boolean;
  /** A first message is being sent, or one failed to go and must not be lost. */
  sending?: boolean;
  queuedOrBusy: boolean;
  localQueuedCount: number;
  composerText: string | null | undefined;
}): boolean {
  if (!input.draft || input.sending || input.queuedOrBusy || input.localQueuedCount > 0) return false;
  return !String(input.composerText ?? '').trim();
}

function sideChatNoticeText(countRaw: number, disposition: 'archived' | 'deleted', sourceCount: number): string {
  const count = Number.isFinite(countRaw) ? Math.max(0, Math.floor(countRaw)) : 0;
  if (count === 0) return '';
  const owner = sourceCount === 1 ? 'Its' : 'Their';
  return count === 1
    ? ` ${owner} side chat will be ${disposition} too.`
    : ` ${owner} ${count} side chats will be ${disposition} too.`;
}
