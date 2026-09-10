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
  test('ASAP sends follow the focused window and preserve the delivery mode', () => {
    const registry = new ActiveComposerRegistry();
    const sends: string[] = [];
    for (const id of ['main', 'floating']) {
      registry.register({
        ...composer(id, { eligible: true }),
        requiresExplicitFocus: id === 'floating',
        sendMessage: (mode) => { sends.push(`${id}:${mode}`); return true; },
      });
    }
    registry.focusWithin(() => 'floating');
    expect(registry.sendMessage('asap')).toBe(true);
    registry.focusDefault();
    expect(registry.sendMessage('asap')).toBe(true);
    expect(sends).toEqual(['floating:asap', 'main:asap']);

    // A loading floating chat must never send another chat's draft.
    registry.focusWithin(() => null);
    expect(registry.sendMessage('asap')).toBe(false);
    expect(sends).toHaveLength(2);
  });

  test('an empty focused composer does not fall through to another chat', () => {
    const registry = new ActiveComposerRegistry();
    let mainSends = 0;
    registry.register({
      ...composer('main', { eligible: true }),
      sendMessage: () => { mainSends++; return true; },
    });
    registry.register({
      ...composer('floating', { eligible: true }),
      requiresExplicitFocus: true,
      sendMessage: () => false,
    });
    registry.focusWithin(() => 'floating');
    expect(registry.sendMessage('asap')).toBe(false);
    expect(mainSends).toBe(0);
  });

  test('side chats never become fallback targets, even when the main composer is disabled', () => {
    const registry = new ActiveComposerRegistry();
    const main = { eligible: false, readable: true };
    registry.register(composer('main', main));
    registry.register({ ...composer('side', { eligible: true }), requiresExplicitFocus: true });
    expect(registry.ensureTargetId()).toBeNull();
    registry.focus('side');
    expect(registry.ensureTargetId()).toBe('side');
    registry.focus('main');
    expect(registry.ensureTargetId()).toBeNull();
    expect(registry.readActiveComposer().targetId).toBe('main');
    main.eligible = true;
    expect(registry.ensureTargetId()).toBe('main');
  });
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

  test('routes composer shortcuts to the active eligible composer', () => {
    const registry = new ActiveComposerRegistry();
    const actions: string[] = [];
    registry.register({
      ...composer('first', { eligible: true }),
      toggleVoiceRecording: () => {
        actions.push('first:record');
        return true;
      },
    });
    registry.register({
      ...composer('second', { eligible: true }),
      voiceRecordingStatus: () => 'recording',
      sendMessage: () => {
        actions.push('second:send');
        return true;
      },
      toggleVoiceRecording: () => {
        actions.push('second:record');
        return true;
      },
      toggleVoiceRecordingPause: () => {
        actions.push('second:pause');
        return true;
      },
      discardVoiceRecording: () => {
        actions.push('second:discard');
        return true;
      },
      clearComposer: () => {
        actions.push('second:clear');
        return true;
      },
    });
    registry.focus('second');

    expect(registry.sendMessage()).toBe(true);
    expect(registry.toggleVoiceRecording()).toBe(true);
    expect(registry.toggleVoiceRecordingPause()).toBe(true);
    expect(registry.discardVoiceRecording()).toBe(true);
    expect(registry.clearComposer()).toBe(true);
    expect(actions).toEqual([
      'second:send',
      'second:record',
      'second:pause',
      'second:discard',
      'second:clear',
    ]);
  });

  test('Q and S follow focus while W and E follow the recording even when its chat is hidden', () => {
    const registry = new ActiveComposerRegistry();
    const actions: string[] = [];
    const state = { eligible: true };
    let status: 'idle' | 'recording' | 'paused' = 'idle';
    registry.register({
      ...composer('recording-chat', state),
      voiceRecordingStatus: () => status,
      toggleVoiceRecording: () => { status = 'recording'; actions.push('recording-chat:q'); return true; },
      toggleVoiceRecordingPause: () => { status = status === 'paused' ? 'recording' : 'paused'; actions.push('recording-chat:w'); return true; },
      discardVoiceRecording: () => { status = 'idle'; actions.push('recording-chat:e'); return true; },
    });
    registry.register({
      ...composer('focused-chat', { eligible: true }),
      sendMessage: () => { actions.push('focused-chat:s'); return true; },
      toggleVoiceRecording: () => { actions.push('focused-chat:q'); return true; },
    });
    registry.focus('recording-chat');
    registry.toggleVoiceRecording();
    registry.focus('focused-chat');
    state.eligible = false;
    expect(registry.toggleVoiceRecordingPause()).toBe(true);
    expect(status).toBe('paused');
    expect(registry.toggleVoiceRecordingPause()).toBe(true);
    expect(status).toBe('recording');
    registry.sendMessage();
    registry.discardVoiceRecording();
    expect(registry.toggleVoiceRecordingPause()).toBe(false);
    expect(registry.discardVoiceRecording()).toBe(false);
    registry.toggleVoiceRecording();
    expect(registry.getSnapshot()).toBe('focused-chat');
    expect(actions).toEqual(['recording-chat:q', 'recording-chat:w', 'recording-chat:w', 'focused-chat:s', 'recording-chat:e', 'focused-chat:q']);
  });

  test('prefers a live recording over another chat still transcribing and forgets unmounted owners', () => {
    const registry = new ActiveComposerRegistry();
    const actions: string[] = [];
    registry.register({ ...composer('old', { eligible: true }), voiceRecordingStatus: () => 'transcribing', discardVoiceRecording: () => { actions.push('old'); return true; } });
    const unregister = registry.register({ ...composer('live', { eligible: false }), voiceRecordingStatus: () => 'recording', discardVoiceRecording: () => { actions.push('live'); return true; } });
    registry.focus('old');
    registry.discardVoiceRecording();
    unregister();
    registry.discardVoiceRecording();
    expect(actions).toEqual(['live', 'old']);
  });
});
