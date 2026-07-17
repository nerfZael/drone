import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { ensureTestNativeChat } from './native-chat-test-helpers';
import { withTempDroneDataDir } from './test-helpers';

function service() {
  return new HubAssistantService({ listDrones: async () => [] });
}

describe('native chat isolation', () => {
  test('returns only the requested chat and keeps chat settings independent', async () => {
    await withTempDroneDataDir('native-chat-isolation-', async () => {
      const assistant = service();
      const first = await ensureTestNativeChat(assistant, {
        id: 'native-first',
        droneId: 'drone-a',
        chatName: 'first',
      });
      await ensureTestNativeChat(assistant, {
        id: 'native-second',
        droneId: 'drone-a',
        chatName: 'second',
      });
      await assistant.updateThread(first.chatId, {
        thinkingLevel: 'high',
        enabledTools: ['list_drones'],
      });

      const firstSnapshot = await assistant.threadSnapshot('native-first');
      const secondSnapshot = await assistant.threadSnapshot('native-second');
      expect(firstSnapshot.chatId).toBe('native-first');
      expect(firstSnapshot.threads.map((chat) => chat.id)).toEqual(['native-first']);
      expect(firstSnapshot.threads[0]?.thinkingLevel).toBe('high');
      expect(secondSnapshot.threads.map((chat) => chat.id)).toEqual(['native-second']);
      expect(secondSnapshot.threads[0]?.thinkingLevel).not.toBe('high');
    });
  });

  test('updates owner metadata without changing stable chat identity', async () => {
    await withTempDroneDataDir('native-chat-owner-', async () => {
      const assistant = service();
      await ensureTestNativeChat(assistant, {
        id: 'native-chat',
        droneId: 'drone-a',
        chatName: 'before',
      });
      const renamed = await assistant.ensureNativeThread({
        id: 'native-chat',
        droneId: 'drone-a',
        chatName: 'after',
        title: 'after',
      });

      expect(renamed.chatId).toBe('native-chat');
      expect(renamed.threads[0]).toMatchObject({
        id: 'native-chat',
        ownerDroneId: 'drone-a',
        ownerChatName: 'after',
        title: 'after',
      });
    });
  });

  test('clones configuration into a new stable chat without sharing later changes', async () => {
    await withTempDroneDataDir('native-chat-clone-', async () => {
      const assistant = service();
      await ensureTestNativeChat(assistant, {
        id: 'native-source',
        droneId: 'drone-a',
        chatName: 'source',
      });
      await assistant.updateThread('native-source', {
        autoApprove: true,
        promptDeliveryMode: 'asap',
        enabledTools: ['list_drones'],
      });
      const cloned = await assistant.cloneNativeThread({
        sourceId: 'native-source',
        id: 'native-copy',
        droneId: 'drone-a',
        chatName: 'copy',
      });
      expect(cloned.threads[0]).toMatchObject({
        id: 'native-copy',
        autoApprove: true,
        promptDeliveryMode: 'asap',
        enabledTools: ['list_drones'],
      });

      await assistant.updateThread('native-copy', { autoApprove: false });
      expect((await assistant.threadSnapshot('native-source')).threads[0]?.autoApprove).toBe(true);
    });
  });

  test('deletes only the selected native chat and does not create a placeholder', async () => {
    await withTempDroneDataDir('native-chat-delete-', async () => {
      const assistant = service();
      await ensureTestNativeChat(assistant, { id: 'native-first', droneId: 'drone-a' });
      await ensureTestNativeChat(assistant, { id: 'native-second', droneId: 'drone-a' });

      expect(await assistant.deleteThread('native-first')).toEqual({
        ok: true,
        deleted: true,
        threadId: 'native-first',
      });
      await expect(assistant.threadSnapshot('native-first')).rejects.toThrow(
        'unknown assistant thread',
      );
      expect((await assistant.threadSnapshot('native-second')).chatId).toBe('native-second');
    });
  });
});
