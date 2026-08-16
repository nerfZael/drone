import { describe, expect, test } from 'bun:test';
import {
  cleanLocalDroneRecords,
  createLegacyPhoneDroneRecord,
  localDroneDraftChatMap,
  localDroneDraftPromptsForChat,
} from '../src/drones/local-drone-records';
import type { LocalAssistantThread } from '../src/local-assistant/local-assistant-types';

function thread(id: string, title: string, createdAt: string): LocalAssistantThread {
  return {
    id,
    title,
    createdAt,
    updatedAt: createdAt,
    model: 'gpt-5',
    thinkingLevel: 'medium',
    status: 'idle',
    error: null,
    workspaceTargets: [],
    messages: [],
    queuedPrompts: [],
  };
}

describe('local drone records', () => {
  test('migrates existing assistant threads into one stable phone drone', () => {
    expect(
      createLegacyPhoneDroneRecord([
        thread('newer', 'Review', '2026-02-01T00:00:00.000Z'),
        thread('older', 'Review', '2026-01-01T00:00:00.000Z'),
      ]),
    ).toEqual({
      id: 'phone_drone_legacy_assistant',
      name: 'Phone assistant',
      group: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      chats: {
        Review: 'newer',
        'Review 2': 'older',
      },
    });
  });

  test('bounds persisted record fields while preserving chat links', () => {
    expect(
      cleanLocalDroneRecords([
        {
          id: `phone_${'x'.repeat(200)}`,
          name: 'Phone',
          group: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          chats: { default: 'thread-1' },
        },
      ])[0],
    ).toMatchObject({
      name: 'Phone',
      chats: { default: 'thread-1' },
    });
  });

  test('preserves queued text and image references for local draft drones', () => {
    expect(
      cleanLocalDroneRecords([
        {
          id: 'phone-draft',
          name: 'Phone draft',
          group: null,
          createdAt: '2026-08-07T00:00:00.000Z',
          chats: { default: 'thread-1' },
          draft: true,
          draftPrompts: [
            {
              id: 'draft-prompt-1',
              prompt: 'Review this image',
              createdAt: '2026-08-07T00:00:00.000Z',
              promptImages: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
            },
          ],
        },
      ])[0],
    ).toMatchObject({
      draft: true,
      draftPrompts: [
        {
          id: 'draft-prompt-1',
          prompt: 'Review this image',
          promptImages: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
        },
      ],
    });
  });

  test('preserves draft state and queued prompts for individual phone chats', () => {
    expect(
      cleanLocalDroneRecords([
        {
          id: 'phone-drone',
          name: 'Phone drone',
          group: null,
          createdAt: '2026-08-16T00:00:00.000Z',
          chats: { default: 'thread-1', review: 'thread-2' },
          draftChats: { review: true, missing: true },
          draftChatPrompts: {
            review: [
              {
                id: 'review-prompt',
                prompt: 'Review this.',
                createdAt: '2026-08-16T00:00:00.000Z',
                promptImages: [],
              },
            ],
          },
        },
      ])[0],
    ).toMatchObject({
      draftChats: { review: true },
      draftChatPrompts: {
        review: [{ id: 'review-prompt', prompt: 'Review this.' }],
      },
    });
  });

  test('keeps separate queues for every chat in a draft drone', () => {
    const drone = cleanLocalDroneRecords([{
      id: 'phone-draft',
      name: 'Draft',
      group: null,
      chats: { default: 'thread-1', review: 'thread-2' },
      draft: true,
      draftPrompts: [{ id: 'default-prompt', prompt: 'Default', promptImages: [] }],
      draftChatPrompts: {
        review: [{ id: 'review-prompt', prompt: 'Review', promptImages: [] }],
      },
    }])[0]!;

    expect(localDroneDraftChatMap(drone)).toEqual({ default: true, review: true });
    expect(localDroneDraftPromptsForChat(drone, 'default')[0]?.prompt).toBe('Default');
    expect(localDroneDraftPromptsForChat(drone, 'review')[0]?.prompt).toBe('Review');
  });
});
