import { expect, test } from 'bun:test';
import { withDroneOpLock } from '../src/hub/drone-op-lock';
import { PendingPromptPump } from '../src/hub/pending-prompt-pump';
import { resolvePromptChatName } from '../src/hub/prompt-chat-identity';
import {
  deleteChatFromStore,
  listChatsFromStore,
  readChatMetadataFromStore,
  renameChatInStore,
  upsertChatInStore,
} from '../src/hub/transcript-store';
import { withTempDroneDataDir } from './test-helpers';

const originalName = 'Untitled 1';
const renamedName = 'Draft Futuristic Building Designs';

function resolveName(droneId: string, chatEntryId: string) {
  return resolvePromptChatName({
    droneId, chatEntryId, chatName: originalName,
    readMetadata: readChatMetadataFromStore,
    listChats: listChatsFromStore,
  });
}

async function seed(droneId: string) {
  await upsertChatInStore({
    droneId, chatName: originalName,
    chatEntry: { id: `${droneId}-chat`, agent: { kind: 'builtin', id: 'codex' } },
  });
  return readChatMetadataFromStore({ droneId, chatName: originalName }).chat!.id;
}

test('rename during first-message preparation dispatches the original Codex identity', async () => {
  await withTempDroneDataDir('prompt-rename-race-', async () => {
    const droneId = 'rename-during-preparation';
    const chatEntryId = await seed(droneId);
    const preparing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const dispatched = Promise.withResolvers<any>();
    const pump = new PendingPromptPump({
      normalizeDroneId: value => value,
      normalizeChatName: value => value,
      concurrencyLimit: () => 1,
      defaultRetryDelayMs: () => 1000,
      run: async target => {
        preparing.resolve();
        await resume.promise;
        try {
          await withDroneOpLock(`drone:${droneId}`, async () => {
            const chatName = resolvePromptChatName({
              ...target, chatEntryId,
              readMetadata: readChatMetadataFromStore,
              listChats: listChatsFromStore,
            });
            dispatched.resolve({ chatName, chat: readChatMetadataFromStore({ droneId, chatName }).chat });
          });
        } catch (error) {
          dispatched.reject(error);
        }
      },
    });
    try {
      pump.start();
      pump.enqueue(droneId, originalName);
      await preparing.promise;
      await renameChatInStore({ droneId, chatName: originalName, newChatName: renamedName });
      pump.migrate(droneId, originalName, renamedName);
      resume.resolve();
      expect(await dispatched.promise).toMatchObject({
        chatName: renamedName, chat: { id: chatEntryId, agent: { id: 'codex' } },
      });
      expect(listChatsFromStore({ droneId }).chats).toEqual([renamedName]);
    } finally {
      resume.resolve();
      await pump.stop();
    }
  });
});

test('rename waits until agent session startup releases the dispatch lock', async () => {
  await withTempDroneDataDir('prompt-rename-startup-', async () => {
    const droneId = 'rename-during-startup';
    const chatEntryId = await seed(droneId);
    const starting = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const dispatch = withDroneOpLock(`drone:${droneId}`, async () => {
      const chatName = resolveName(droneId, chatEntryId);
      starting.resolve();
      await resume.promise;
      expect(readChatMetadataFromStore({ droneId, chatName }).chat?.id).toBe(chatEntryId);
    });
    await starting.promise;
    let renamed = false;
    const rename = renameChatInStore({ droneId, chatName: originalName, newChatName: renamedName })
      .then(() => { renamed = true; });
    try {
      await Promise.resolve();
      expect(renamed).toBe(false);
      expect(resolveName(droneId, chatEntryId)).toBe(originalName);
    } finally {
      resume.resolve();
      await Promise.all([dispatch, rename]);
    }
    expect(resolveName(droneId, chatEntryId)).toBe(renamedName);
  });
});

test('a reused name cannot redirect a prompt and a deleted identity is never recreated', async () => {
  await withTempDroneDataDir('prompt-reused-name-', async () => {
    const droneId = 'reused-name';
    const chatEntryId = await seed(droneId);
    await renameChatInStore({ droneId, chatName: originalName, newChatName: renamedName });
    await upsertChatInStore({
      droneId, chatName: originalName,
      chatEntry: { id: 'different-chat', agent: { kind: 'builtin', id: 'cursor' } },
    });
    expect(resolveName(droneId, chatEntryId)).toBe(renamedName);
    await deleteChatFromStore({ droneId, chatName: renamedName });
    expect(() => resolveName(droneId, chatEntryId)).toThrow('unknown chat identity');
    expect(listChatsFromStore({ droneId }).chats).toEqual([originalName]);
    expect(() => resolveName(droneId, '')).toThrow('no stable chat identity');
  });
});
