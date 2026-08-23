import { describe, expect, test } from 'bun:test';
import { sidebarChatNodeId } from '@drone/hub-model/sidebar';
import { resolveMobileChatDeletePlan } from '../src/local-assistant/mobile-chat-delete';

describe('mobile chat deletion', () => {
  test('deletes only the pressed chat when it is outside the selection', () => {
    const plan = resolveMobileChatDeletePlan({
      droneId: 'drone-1',
      chatNames: ['default', 'review', 'planning'],
      targetChatName: 'review',
      selectedChatNodeIds: new Set([
        sidebarChatNodeId('drone-1', 'planning'),
      ]),
    });

    expect(plan).toEqual({
      chatNames: ['review'],
      defaultChatKept: false,
    });
  });

  test('uses the selected chats and protects the default chat', () => {
    const plan = resolveMobileChatDeletePlan({
      droneId: 'drone-1',
      chatNames: ['default', 'review', 'planning'],
      targetChatName: 'review',
      selectedChatNodeIds: new Set([
        sidebarChatNodeId('drone-1', 'default'),
        sidebarChatNodeId('drone-1', 'review'),
        sidebarChatNodeId('drone-1', 'planning'),
        sidebarChatNodeId('another-drone', 'unrelated'),
      ]),
    });

    expect(plan).toEqual({
      chatNames: ['review', 'planning'],
      defaultChatKept: true,
    });
  });

  test('never schedules the default chat for deletion', () => {
    expect(resolveMobileChatDeletePlan({
      droneId: 'drone-1',
      chatNames: ['default', 'review'],
      targetChatName: 'default',
      selectedChatNodeIds: new Set(),
    }).chatNames).toEqual([]);
  });
});
