import { getDroneLifecycleRepository, type CanonicalDroneLifecycleState } from './drone-lifecycle-repository';
import { getPromptQueueRepository } from './prompt-queue-repository';
import {
  deleteChatFromStore,
  upsertChatInStore,
} from '../hub/transcript-store';

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function byIdentity(bucket: unknown): Map<string, any> {
  const out = new Map<string, any>();
  for (const [key, value] of Object.entries(objectRecord(bucket))) {
    const id = String(value?.id ?? key).trim();
    if (id) out.set(id, value);
  }
  return out;
}

async function syncLifecycle(before: any, after: any): Promise<void> {
  const repository = await getDroneLifecycleRepository();
  if (!repository) return;
  const states: Array<[CanonicalDroneLifecycleState, string]> = [
    ['real', 'drones'], ['pending', 'pending'], ['archived', 'archived'],
  ];
  const beforeAll = new Map<string, { state: CanonicalDroneLifecycleState; entry: any }>();
  const afterAll = new Map<string, { state: CanonicalDroneLifecycleState; entry: any }>();
  for (const [state, key] of states) {
    for (const [id, entry] of byIdentity(before?.[key])) beforeAll.set(id, { state, entry });
    for (const [id, entry] of byIdentity(after?.[key])) afterAll.set(id, { state, entry });
  }
  for (const [id, current] of afterAll) {
    const prior = beforeAll.get(id);
    if (!prior || prior.state !== current.state || !same(prior.entry, current.entry)) {
      await repository.upsert(current.state, id, current.entry);
    }
  }
  for (const [id, prior] of beforeAll) {
    if (!afterAll.has(id)) await repository.delete(id, prior.state);
  }

  const beforeDrones = byIdentity(before?.drones);
  const afterDrones = byIdentity(after?.drones);
  for (const [droneId, entry] of afterDrones) {
    const oldChats = objectRecord(beforeDrones.get(droneId)?.chats);
    const newChats = objectRecord(entry?.chats);
    for (const [chatName, chatEntry] of Object.entries(newChats)) {
      if (!same(oldChats[chatName], chatEntry)) {
        await upsertChatInStore({ droneId, chatName, chatEntry });
        const queue = getPromptQueueRepository();
        const oldPrompts = byIdentity(Object.fromEntries(
          (oldChats[chatName]?.pendingPrompts ?? []).map((item: any) => [item.id, item]),
        ));
        const newPrompts = byIdentity(Object.fromEntries(
          ((chatEntry as any)?.pendingPrompts ?? []).map((item: any) => [item.id, item]),
        ));
        if (queue) {
          await queue.backfillLegacy({ droneId, chatName, prompts: [...newPrompts.values()] });
          for (const [promptId, prompt] of newPrompts) {
            if (oldPrompts.has(promptId) && !same(oldPrompts.get(promptId), prompt)) {
              await queue.update({
                droneId,
                chatName,
                promptId,
                patch: {
                  state: prompt.state,
                  error: prompt.error,
                  observability: prompt.observability,
                  blipClones: prompt.blipClones,
                  updatedAt: prompt.updatedAt,
                },
              });
            }
          }
          for (const promptId of oldPrompts.keys()) {
            if (!newPrompts.has(promptId)) await queue.cancelQueued({ droneId, chatName, promptId });
          }
        }
      }
    }
    for (const chatName of Object.keys(oldChats)) {
      if (!(chatName in newChats)) await deleteChatFromStore({ droneId, chatName });
    }
  }
}

/**
 * Translates the remaining registry-first lifecycle/chat callers into their
 * canonical owners. Other migrated domains intentionally ignore compatibility
 * mutations so stale snapshots cannot overwrite canonical rows.
 */
export async function applyRegistryCompatibilityMutation(before: any, after: any): Promise<void> {
  await syncLifecycle(before, after);
}
