import { describe, expect, test } from 'bun:test';
import {
  createDraftQueuedPrompt,
  createSubmittedDraftChat,
  visibleDraftQueuedPrompts,
} from '../src/droneHub/app/draft-chat-queue';

describe('draft chat queue helpers', () => {
  test('creates the first optimistic turn as sent with a stable display name', () => {
    const draft = createSubmittedDraftChat({
      payload: { prompt: 'Inspect the repository' },
      droneName: 'Untitled 1',
      id: 'draft-first',
      at: '2026-07-21T12:00:00.000Z',
    });

    expect(draft?.droneName).toBe('Untitled 1');
    expect(draft?.prompt).toMatchObject({
      id: 'draft-first',
      prompt: 'Inspect the repository',
      state: 'sent',
    });
  });

  test('creates a queued draft prompt with attachment previews intact', () => {
    const item = createDraftQueuedPrompt({
      prompt: 'follow-up',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
    });
    expect(item).not.toBeNull();
    expect(item?.prompt).toBe('follow-up');
    expect(item?.state).toBe('queued');
    expect(item?.attachments).toEqual([
      {
        name: 'shot.png',
        mime: 'image/png',
        size: 42,
        previewDataUrl: 'data:image/png;base64,abc123',
      },
    ]);
    expect(item?.attachmentPayloads).toEqual([{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }]);
  });

  test('shows local pre-id queued prompts before staged per-drone prompts and skips the mirrored first prompt once', () => {
    const visible = visibleDraftQueuedPrompts({
      pendingPrompt: {
        id: 'draft-1',
        at: '2026-03-11T10:00:00.000Z',
        prompt: 'first message',
        state: 'sending',
        attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, fileName: 'shot.png', path: '/tmp/shot.png', relativePath: 'shot.png' }],
      },
      localQueuedPrompts: [
        {
          id: 'local-1',
          at: '2026-03-11T10:00:01.000Z',
          prompt: 'second message',
          state: 'queued',
        },
      ],
      stagedQueuedPrompts: [
        {
          id: 'mirror-1',
          at: '2026-03-11T10:00:02.000Z',
          prompt: 'first message',
          state: 'queued',
          attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, fileName: 'shot.png', path: '/tmp/shot.png', relativePath: 'shot.png' }],
        },
        {
          id: 'staged-2',
          at: '2026-03-11T10:00:03.000Z',
          prompt: 'third message',
          state: 'queued',
        },
      ],
    });

    expect(visible.map((item) => item.id)).toEqual(['local-1', 'staged-2']);
  });
});
