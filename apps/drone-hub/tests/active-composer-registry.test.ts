import { describe, expect, test } from 'bun:test';

import {
  ActiveComposerRegistry,
  type ActiveComposer,
} from '../src/droneHub/chat/ActiveComposerContext';

function composer(
  id: string,
  state: { eligible: boolean; readable?: boolean; content?: string },
): ActiveComposer {
  return {
    id,
    isEligible: () => state.eligible,
    isReadable: () => state.readable ?? state.eligible,
    appendTranscript: (text) => {
      state.content = `${state.content ?? ''}${text}`;
    },
    readSnapshot: () => ({
      targetId: id,
      path: '',
      content: state.content ?? '',
      revision: `revision:${state.content ?? ''}`,
      mode: 'edit',
    }),
    applyContent: (_baseRevision, content) => {
      state.content = content;
      return { ok: true, revision: `revision:${content}` };
    },
  };
}

describe('ActiveComposerRegistry', () => {
  test('tracks focus and keeps transcript routing on the captured target', () => {
    const registry = new ActiveComposerRegistry();
    const firstState = { eligible: true, content: '' };
    const secondState = { eligible: true, content: '' };
    registry.register(composer('first', firstState));
    registry.register(composer('second', secondState));

    expect(registry.ensureTargetId()).toBe('first');
    registry.focus('second');
    expect(registry.getSnapshot()).toBe('second');
    expect(registry.appendTranscript('second', 'hello')).toBe(true);
    expect(secondState.content).toBe('hello');
    expect(firstState.content).toBe('');
  });

  test('falls back when the active composer becomes ineligible', () => {
    const registry = new ActiveComposerRegistry();
    const firstState = { eligible: true };
    const secondState = { eligible: true };
    registry.register(composer('first', firstState));
    registry.register(composer('second', secondState));
    registry.focus('second');

    secondState.eligible = false;
    expect(registry.ensureTargetId()).toBe('first');
    expect(registry.appendTranscript('second', 'ignored')).toBe(false);
  });

  test('rejects patches aimed at a stale composer target', () => {
    const registry = new ActiveComposerRegistry();
    const firstState = { eligible: true, content: 'one' };
    const secondState = { eligible: true, content: 'two' };
    registry.register(composer('first', firstState));
    registry.register(composer('second', secondState));
    registry.focus('second');

    expect(() => registry.applyComposer('first', 'revision:one', 'changed')).toThrow(
      'STALE_COMPOSER_TARGET',
    );
    expect(registry.applyComposer('second', 'revision:two', 'changed')).toEqual({
      ok: true,
      revision: 'revision:changed',
    });
    expect(registry.readActiveComposer().content).toBe('changed');
  });
});
