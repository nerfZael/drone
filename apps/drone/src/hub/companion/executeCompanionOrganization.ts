import { randomUUID } from 'node:crypto';
import { validateCompanionProposal, type CompanionOrganizationOperation } from '@drone/assistant-chat';
import {
  buildSidebarChatTree,
  buildChatOrganizationIntent,
  normalizeSidebarLayout,
  sidebarChatNodeId,
} from '@drone/hub-model';
import type { HubServices } from '../application/hub-services';
import type { SidebarCommandService } from '../sidebar-command-service';
import { resolveCanonicalDroneOrPendingForReadRef } from '../drone-lifecycle-service';
import { importDroneChatsFromRegistry, listChatsFromStore, readChatFromStore } from '../transcript-store';
import { isSideChatEntry } from '../side-chat-checkpoint';
import { isWorkflowChatEntry } from '../workflows/workflow-chat-metadata';

type Dependencies = {
  services: HubServices;
  sidebar: Pick<SidebarCommandService, 'move'>;
  readChats?: (droneId: string) => Promise<string[]>;
};

/** Shared by desktop proposal Apply and the permissioned mobile transport. */
export async function executeCompanionOrganization(value: unknown, deps: Dependencies): Promise<Record<string, unknown>> {
  const operation = validateCompanionProposal({ version: 1, title: 'Organize chats and drones', operations: [value] }).operations[0]!;
  if (operation.type === 'set_drone_group') {
    const result = await deps.services.groups.setDroneGroup({ droneIds: [operation.droneId], group: operation.group || null });
    if (result.rejected.length) throw new Error(result.rejected[0]!.error);
    return result;
  }
  if (operation.type !== 'create_chat_group' && operation.type !== 'rename_chat_group' && operation.type !== 'delete_chat_group' && operation.type !== 'move_chats') {
    throw new Error('Unsupported organization operation');
  }
  const [chats, preferences] = await Promise.all([
    (deps.readChats ?? readOrganizableChats)(operation.droneId),
    deps.services.settings.uiPreferences.read(),
  ]);
  const layout = normalizeSidebarLayout(preferences.uiPreferences);
  const tree = buildSidebarChatTree({
    droneId: operation.droneId,
    chatNames: [...new Set([...(layout.sidebarChatOrderByDrone[operation.droneId] ?? []), ...chats])].filter((name) => chats.includes(name)),
    groupPaths: layout.sidebarChatGroupPathsByDrone[operation.droneId] ?? [],
    groupByChat: layout.sidebarChatGroupByChat,
    nodeOrderByParent: layout.sidebarChatNodeOrderByParent,
  });
  const intent = buildChatOrganizationIntent(operation, tree);
  if (!intent) return { ok: true, changed: false };
  const result = await deps.sidebar.move({ mutationId: randomUUID(), intent });
  if (!result.ok) throw new Error(String(result.error ?? 'Could not update chat groups'));
  verifyOrganization(operation, normalizeSidebarLayout(result.uiPreferences));
  return { ok: true, droneId: operation.droneId, ...(operation.type === 'delete_chat_group' ? { chatsDeleted: false } : {}) };
}

function verifyOrganization(operation: Exclude<CompanionOrganizationOperation, { type: 'set_drone_group' }>, layout: ReturnType<typeof normalizeSidebarLayout>): void {
  const paths = layout.sidebarChatGroupPathsByDrone[operation.droneId] ?? [];
  let applied: boolean;
  if (operation.type === 'create_chat_group') {
    applied = paths.includes([operation.parentGroup, operation.group].filter(Boolean).join('/'));
  } else if (operation.type === 'rename_chat_group') {
    const newPath = [...operation.group.split('/').slice(0, -1), operation.newName].join('/');
    applied = paths.includes(newPath) && !paths.includes(operation.group);
  } else if (operation.type === 'delete_chat_group') {
    applied = !paths.some((path) => path === operation.group || path.startsWith(`${operation.group}/`));
  } else {
    applied = operation.chats.every((name) => (layout.sidebarChatGroupByChat[sidebarChatNodeId(operation.droneId, name)] || '') === operation.targetGroup);
  }
  if (!applied) throw new Error('Chat organization changed while applying. Refresh the proposal before retrying.');
}

async function readOrganizableChats(droneId: string): Promise<string[]> {
  const resolved = await resolveCanonicalDroneOrPendingForReadRef(droneId);
  if (!resolved) throw new Error(`Unknown drone: ${droneId}`);
  if (resolved.id !== droneId) throw new Error('Use the exact drone ID returned by list_drones');
  if (resolved.kind === 'pending') {
    const prompts = Array.isArray(resolved.pending.startupQueuedPrompts) ? resolved.pending.startupQueuedPrompts : [];
    const names = [...new Set<string>(prompts.map((prompt: any) => String(prompt?.chatName ?? 'default').trim() || 'default'))];
    return names.length ? names : ['default'];
  }
  let stored = listChatsFromStore({ droneId: resolved.id });
  if ((globalThis as any).Bun || !stored.available) stored = await importDroneChatsFromRegistry({ droneId: resolved.id, chats: resolved.drone.chats });
  return stored.chats.filter((name) => {
    const chat = readChatFromStore({ droneId: resolved.id, chatName: name }).chat;
    return !isSideChatEntry(chat) && !isWorkflowChatEntry(chat);
  });
}
