import { describe, expect, test } from 'bun:test';
import {
  cleanLocalDroneRecords,
  createLegacyPhoneDroneRecord,
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
});
