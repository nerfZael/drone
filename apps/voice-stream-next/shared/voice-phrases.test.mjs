import { describe, expect, test } from 'bun:test';

import {
  VOICE_PHRASE_DEFAULTS,
  buildAwakeWakeGrammar,
  buildSleepWakeGrammar,
  matchesPhrase,
  sleepPhraseMatch,
} from './voice-phrases.js';

describe('voice-phrases', () => {
  test('matches configured unlock phrase', () => {
    expect(matchesPhrase('please wake up now please', VOICE_PHRASE_DEFAULTS.unlockPhrase)).toBe(true);
    expect(matchesPhrase('wake up', VOICE_PHRASE_DEFAULTS.unlockPhrase)).toBe(false);
  });

  test('matches configured shutdown phrase', () => {
    expect(matchesPhrase('please shut down completely', VOICE_PHRASE_DEFAULTS.shutdownPhrase)).toBe(true);
  });

  test('sleep phrase match returns unlock or shutdown', () => {
    expect(sleepPhraseMatch('wake up now', VOICE_PHRASE_DEFAULTS.unlockPhrase, VOICE_PHRASE_DEFAULTS.shutdownPhrase)).toBe('unlock');
    expect(sleepPhraseMatch('shut down completely', VOICE_PHRASE_DEFAULTS.unlockPhrase, VOICE_PHRASE_DEFAULTS.shutdownPhrase)).toBe('shutdown');
  });

  test('awake grammar omits freestanding hey and sebastian tokens', () => {
    const grammar = buildAwakeWakeGrammar({ triggerPhrase: 'approval code' });
    expect(grammar).toContain('hey sebastian');
    expect(grammar).not.toContain('hey');
    expect(grammar).not.toContain('sebastian');
  });

  test('awake grammar includes shutdown phrase when configured', () => {
    const grammar = buildAwakeWakeGrammar({
      triggerPhrase: 'approval code',
      shutdownPhrase: 'shut down completely',
    });
    expect(grammar).toContain('shut down completely');
  });

  test('awake grammar includes assistant playback stop phrases', () => {
    const grammar = buildAwakeWakeGrammar({ triggerPhrase: 'approval code' });
    expect(grammar).toContain('ok stop');
    expect(grammar).toContain('okay stop');
    expect(grammar).toContain('repeat what you said');
  });

  test('sleep grammar only includes configured phrases', () => {
    const grammar = buildSleepWakeGrammar({
      unlockPhrase: 'wake up now',
      shutdownPhrase: 'shut down completely',
    });
    expect(grammar).toEqual([
      'wake up now',
      'shut down completely',
      '[unk]',
    ]);
  });
});
