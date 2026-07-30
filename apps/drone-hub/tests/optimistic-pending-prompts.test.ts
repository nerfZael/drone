import { describe, expect, test } from 'bun:test';
import {
  appendOptimisticPendingPrompt,
  createOptimisticPendingPrompt,
  mergeDesktopOptimisticPendingPrompts,
  normalizePendingPromptState,
  optimisticPendingPromptState,
  pendingPromptShowsWorkingState,
  reconcileOptimisticPendingPrompt,
  selectedChatRespondingStatus,
} from '../src/droneHub/app/optimistic-pending-prompts';

describe('optimistic pending prompt helpers', () => {
  test('presents follow-up submissions as queued while the chat is responding', () => {
    expect(optimisticPendingPromptState(true)).toBe('queued');
    expect(optimisticPendingPromptState(false)).toBe('sending');
  });

  test('only presents submitted prompts as active agent work', () => {
    expect(pendingPromptShowsWorkingState({ state: 'queued' })).toBe(false);
    expect(pendingPromptShowsWorkingState({ state: 'sending' })).toBe(true);
    expect(pendingPromptShowsWorkingState({ state: 'sent' })).toBe(true);
    expect(pendingPromptShowsWorkingState({ state: 'failed' })).toBe(false);
  });

  test('keeps the desktop sending fallback for unknown server states', () => {
    expect(normalizePendingPromptState('running')).toBe('sending');
    expect(normalizePendingPromptState('running', 'queued')).toBe('queued');
  });

  test('does not leave external responding dots active after transcript completion', () => {
    expect(
      selectedChatRespondingStatus({
        includeDroneBusy: false,
        droneBusy: true,
        selectedIsResponding: false,
      }),
    ).toBe(false);
    expect(
      selectedChatRespondingStatus({
        includeDroneBusy: false,
        droneBusy: false,
        selectedIsResponding: true,
      }),
    ).toBe(true);
    expect(
      selectedChatRespondingStatus({
        includeDroneBusy: true,
        droneBusy: true,
        selectedIsResponding: false,
      }),
    ).toBe(true);
  });

  test('creates a local optimistic prompt with preview attachments', () => {
    const item = createOptimisticPendingPrompt({
      prompt: 'ship it',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
      state: 'sending',
    });

    expect(item).not.toBeNull();
    expect(item?.id.startsWith('optimistic-')).toBe(true);
    expect(item?.prompt).toBe('ship it');
    expect(item?.state).toBe('sending');
    expect(item?.attachments).toEqual([
      {
        name: 'shot.png',
        mime: 'image/png',
        size: 42,
        previewDataUrl: 'data:image/png;base64,abc123',
      },
    ]);
  });

  test('creates a readable label for attachment-only optimistic prompts', () => {
    const item = createOptimisticPendingPrompt({
      prompt: '',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
    });

    expect(item?.prompt).toBe('[image attachment]');
  });

  test('creates a readable label for text-only attachment prompts', () => {
    const item = createOptimisticPendingPrompt({
      prompt: '',
      attachments: [{ name: 'pasted.txt', mime: 'text/plain', size: 420, dataBase64: 'abc123' }],
    });

    expect(item?.prompt).toBe('[text attachment]');
  });

  test('reconciles a temporary optimistic id to the confirmed server id', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: 'ship it',
      state: 'sending',
    });
    if (!optimistic) throw new Error('expected optimistic prompt');

    const next = reconcileOptimisticPendingPrompt([optimistic], {
      optimisticId: optimistic.id,
      confirmedId: 'server-1',
      state: 'sent',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('server-1');
    expect(next[0]?.prompt).toBe('ship it');
    expect(next[0]?.state).toBe('sent');
  });

  test('merges with an existing server item instead of keeping a duplicate', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: 'ship it',
      state: 'sending',
    });
    if (!optimistic) throw new Error('expected optimistic prompt');

    const next = reconcileOptimisticPendingPrompt(
      [
        optimistic,
        {
          id: 'server-1',
          at: '2026-03-31T12:00:00.000Z',
          prompt: 'ship it',
          state: 'queued',
        },
      ],
      {
        optimisticId: optimistic.id,
        confirmedId: 'server-1',
        state: 'sent',
      },
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('server-1');
    expect(next[0]?.state).toBe('sent');
  });

  test('keeps optimistic attachment previews when the server duplicate has no attachments yet', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: '',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
      state: 'sending',
    });
    if (!optimistic) throw new Error('expected optimistic prompt');

    const next = reconcileOptimisticPendingPrompt(
      [
        optimistic,
        {
          id: 'server-1',
          at: '2026-03-31T12:00:00.000Z',
          prompt: '[image attachment]',
          state: 'queued',
        },
      ],
      {
        optimisticId: optimistic.id,
        confirmedId: 'server-1',
        state: 'sent',
      },
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.attachments).toEqual(optimistic.attachments);
    expect(next[0]?.attachmentPayloads).toEqual(optimistic.attachmentPayloads);
  });

  test('preserves local preview data when the server duplicate has attachment paths but no preview yet', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: '',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
      state: 'sending',
    });
    if (!optimistic?.attachments?.[0]) throw new Error('expected optimistic attachment');

    const next = reconcileOptimisticPendingPrompt(
      [
        optimistic,
        {
          id: 'server-1',
          at: '2026-03-31T12:00:00.000Z',
          prompt: '[image attachment]',
          state: 'queued',
          attachments: [
            {
              name: 'shot.png',
              mime: 'image/png',
              size: 42,
              path: '/work/repo/shot.png',
            },
          ],
        },
      ],
      {
        optimisticId: optimistic.id,
        confirmedId: 'server-1',
        state: 'sent',
      },
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.attachments).toEqual([
      {
        name: 'shot.png',
        mime: 'image/png',
        size: 42,
        path: '/work/repo/shot.png',
        previewDataUrl: optimistic.attachments[0].previewDataUrl,
      },
    ]);
  });

  test('keeps extra optimistic attachments if the server duplicate is still missing some rows', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: '',
      attachments: [
        { name: 'one.png', mime: 'image/png', size: 41, dataBase64: 'abc123' },
        { name: 'two.png', mime: 'image/png', size: 42, dataBase64: 'def456' },
      ],
      state: 'sending',
    });
    if (!optimistic?.attachments) throw new Error('expected optimistic attachments');

    const next = reconcileOptimisticPendingPrompt(
      [
        optimistic,
        {
          id: 'server-1',
          at: '2026-03-31T12:00:00.000Z',
          prompt: '[2 image attachments]',
          state: 'queued',
          attachments: [
            {
              name: 'one.png',
              mime: 'image/png',
              size: 41,
              path: '/work/repo/one.png',
            },
          ],
        },
      ],
      {
        optimisticId: optimistic.id,
        confirmedId: 'server-1',
        state: 'sent',
      },
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.attachments).toEqual([
      {
        name: 'one.png',
        mime: 'image/png',
        size: 41,
        path: '/work/repo/one.png',
        previewDataUrl: optimistic.attachments[0].previewDataUrl,
      },
      optimistic.attachments[1],
    ]);
  });

  test('appends optimistic items without duplicating the same id', () => {
    const item = createOptimisticPendingPrompt({
      id: 'optimistic-1',
      prompt: 'ship it',
    });
    if (!item) throw new Error('expected optimistic prompt');

    expect(appendOptimisticPendingPrompt([], item)).toEqual([item]);
    expect(appendOptimisticPendingPrompt([item], item)).toEqual([item]);
  });

  test('merges server order with optimistic attachment previews intact', () => {
    const optimistic = createOptimisticPendingPrompt({
      id: 'shared',
      prompt: '',
      attachments: [{ name: 'shot.png', mime: 'image/png', size: 42, dataBase64: 'abc123' }],
      state: 'sending',
    });
    if (!optimistic?.attachments?.[0]) throw new Error('expected optimistic attachment');

    const merged = mergeDesktopOptimisticPendingPrompts({
      serverPrompts: [
        {
          id: 'server-first',
          at: '2026-07-29T10:00:00.000Z',
          prompt: 'first',
          state: 'sent',
        },
        {
          id: 'shared',
          at: '2026-07-29T10:00:01.000Z',
          prompt: '[image attachment]',
          state: 'queued',
          attachments: [
            {
              name: 'shot.png',
              mime: 'image/png',
              size: 42,
              path: '/work/repo/shot.png',
            },
          ],
        },
      ],
      optimisticPrompts: [optimistic],
      nowMs: Date.parse('2026-07-29T10:00:02.000Z'),
    });

    expect(merged.map((prompt) => prompt.id)).toEqual(['server-first', 'shared']);
    expect(merged[1]).toMatchObject({
      state: 'sending',
      attachments: [
        {
          path: '/work/repo/shot.png',
          previewDataUrl: optimistic.attachments[0].previewDataUrl,
        },
      ],
    });
    expect(merged[1]?.attachmentPayloads).toEqual(optimistic.attachmentPayloads);
  });

  test('does not surface malformed pending rows without an id', () => {
    expect(
      mergeDesktopOptimisticPendingPrompts({
        serverPrompts: [
          {
            id: '',
            at: '2026-07-29T10:00:00.000Z',
            prompt: 'invalid',
            state: 'sent',
          },
        ],
        optimisticPrompts: [],
        nowMs: Date.parse('2026-07-29T10:00:01.000Z'),
      }),
    ).toEqual([]);
  });
});
