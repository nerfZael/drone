import { describe, expect, test } from 'bun:test';
import {
  PENDING_PROMPT_STATES,
  completedTurnIds,
  filterCompletedPendingPrompts,
  hasActivePendingPrompt,
  isActivePendingPrompt,
  isActivePendingPromptState,
  isTerminalPendingPrompt,
  isTerminalPendingPromptState,
  mergeOptimisticPendingPrompts,
  normalizePendingPromptState,
  pendingPromptMatchesCompletedTurn,
  replaceOptimisticPendingPromptId,
} from '../src/pending-prompts';

describe('pending prompt lifecycle', () => {
  test('normalizes the four canonical states with an explicit fallback', () => {
    expect(PENDING_PROMPT_STATES).toEqual(['queued', 'sending', 'sent', 'failed']);
    expect(normalizePendingPromptState(' sent ')).toBe('sent');
    expect(normalizePendingPromptState('running')).toBe('sending');
    expect(normalizePendingPromptState('running', 'queued')).toBe('queued');
    expect(normalizePendingPromptState('running', 'invalid' as never)).toBe('sending');
  });

  test('distinguishes queued, active, and terminal states', () => {
    expect(isActivePendingPromptState('queued')).toBe(false);
    expect(isActivePendingPromptState('sending')).toBe(true);
    expect(isActivePendingPromptState('sent')).toBe(true);
    expect(isActivePendingPromptState('failed')).toBe(false);
    expect(isTerminalPendingPromptState('failed')).toBe(true);
    expect(isTerminalPendingPromptState('sent')).toBe(false);
    expect(isActivePendingPrompt({ state: 'sending' })).toBe(true);
    expect(isTerminalPendingPrompt({ state: 'failed' })).toBe(true);
  });

  test('matches completed turns by normalized prompt id', () => {
    expect(pendingPromptMatchesCompletedTurn({ id: ' prompt-1 ' }, { id: 'prompt-1' })).toBe(true);
    expect(pendingPromptMatchesCompletedTurn({ id: 'prompt-1' }, { id: 'prompt-2' })).toBe(false);
    expect(completedTurnIds([{ id: ' turn-1 ' }, {}, null])).toEqual(new Set(['turn-1']));
    expect(
      hasActivePendingPrompt(
        [{ id: 'done', state: 'sent' }, { id: 'queued', state: 'queued' }],
        [{ id: 'done' }],
      ),
    ).toBe(false);
    expect(hasActivePendingPrompt([{ state: 'sent' }], [])).toBe(false);
  });

  test('filters completed work while retaining failed and stopped records', () => {
    const prompts = [
      { id: 'done', state: 'sent' },
      { id: 'failed', state: 'failed', error: 'upload failed' },
      { id: 'stopped', state: 'failed', error: 'Stopped by user.' },
    ];
    expect(
      filterCompletedPendingPrompts(prompts, [
        { id: 'done' },
        { id: 'failed' },
        { id: 'stopped' },
      ]),
    ).toEqual([prompts[1], prompts[2]]);
  });
});

describe('optimistic pending prompt reconciliation', () => {
  test('replaces a temporary id without changing attachment metadata', () => {
    const attachments = [{ name: 'shot.png', previewDataUrl: 'data:image/png;base64,abc' }];
    const prompts = [
      {
        id: 'optimistic-1',
        state: 'sending',
        attachments,
        attachmentPayloads: [{ name: 'shot.png', dataBase64: 'abc' }],
      },
    ];

    const next = replaceOptimisticPendingPromptId(prompts, 'optimistic-1', 'server-1');

    expect(next[0]).toEqual({ ...prompts[0], id: 'server-1' });
    expect(next[0]?.attachments).toBe(attachments);
    expect(prompts[0]?.id).toBe('optimistic-1');
  });

  test('keeps server order and prevents a queued snapshot from downgrading a sending prompt', () => {
    const next = mergeOptimisticPendingPrompts({
      serverPrompts: [
        { id: 'server-first', state: 'sent', prompt: 'first' },
        { id: 'shared', state: 'queued', prompt: 'server copy' },
      ],
      optimisticPrompts: [
        { id: 'shared', state: 'sending', prompt: 'local copy', optimistic: true },
        { id: 'local-last', state: 'queued', prompt: 'last', optimistic: true },
      ],
      nowMs: Date.parse('2026-07-29T10:00:05.000Z'),
    });

    expect(next.map((prompt) => prompt.id)).toEqual([
      'server-first',
      'shared',
      'local-last',
    ]);
    expect(next[1]).toEqual({
      id: 'shared',
      state: 'sending',
      prompt: 'server copy',
      optimistic: true,
    });
  });

  test('uses the latest duplicate value without changing first-seen id order', () => {
    const next = mergeOptimisticPendingPrompts({
      serverPrompts: [
        { id: 'shared', state: 'queued', revision: 1 },
        { id: 'second', state: 'sent', revision: 1 },
        { id: 'shared', state: 'sent', revision: 2 },
      ],
      optimisticPrompts: [],
      nowMs: 0,
    });

    expect(next).toEqual([
      { id: 'shared', state: 'sent', revision: 2 },
      { id: 'second', state: 'sent', revision: 1 },
    ]);
  });

  test('uses the latest optimistic duplicate while preserving local id order', () => {
    expect(
      mergeOptimisticPendingPrompts({
        serverPrompts: [],
        optimisticPrompts: [
          { id: 'shared', state: 'queued', revision: 1 },
          { id: 'second', state: 'sending', revision: 1 },
          { id: 'shared', state: 'sending', revision: 2 },
        ],
        nowMs: 0,
      }),
    ).toEqual([
      { id: 'shared', state: 'sending', revision: 2 },
      { id: 'second', state: 'sending', revision: 1 },
    ]);
  });

  test('drops malformed records without an id from both sources', () => {
    expect(
      mergeOptimisticPendingPrompts({
        serverPrompts: [{ state: 'sent' }, { id: 'server', state: 'sent' }],
        optimisticPrompts: [{ state: 'sending' }, { id: 'local', state: 'sending' }],
        nowMs: 0,
      }),
    ).toEqual([
      { id: 'server', state: 'sent' },
      { id: 'local', state: 'sending' },
    ]);
  });

  test('expires only unconfirmed non-terminal prompts using caller-supplied time', () => {
    const nowMs = Date.parse('2026-07-29T10:00:20.001Z');
    const failed = {
      id: 'failed',
      state: 'failed',
      at: '2026-07-29T10:00:00.000Z',
      error: 'send failed',
    };
    expect(
      mergeOptimisticPendingPrompts({
        serverPrompts: [],
        optimisticPrompts: [
          {
            id: 'expired',
            state: 'sending',
            at: '2026-07-29T10:00:00.000Z',
          },
          failed,
        ],
        nowMs,
        optimisticGraceMs: 20_000,
      }),
    ).toEqual([failed]);
  });

  test('lets the application preserve attachment fields without defining an attachment model', () => {
    const next = mergeOptimisticPendingPrompts({
      serverPrompts: [
        {
          id: 'shared',
          state: 'sent',
          attachments: [{ name: 'shot.png', path: '/work/shot.png' }],
        },
      ],
      optimisticPrompts: [
        {
          id: 'shared',
          state: 'sending',
          attachments: [{ name: 'shot.png', previewDataUrl: 'data:image/png;base64,abc' }],
        },
      ],
      nowMs: 0,
      mergeMatched: ({ optimisticPrompt, serverPrompt, state }) => ({
        ...optimisticPrompt,
        ...serverPrompt,
        state,
        attachments: [
          {
            ...(optimisticPrompt.attachments as Array<Record<string, unknown>>)[0],
            ...(serverPrompt.attachments as Array<Record<string, unknown>>)[0],
          },
        ],
      }),
    });

    expect(next[0]?.attachments).toEqual([
      {
        name: 'shot.png',
        path: '/work/shot.png',
        previewDataUrl: 'data:image/png;base64,abc',
      },
    ]);
  });
});
