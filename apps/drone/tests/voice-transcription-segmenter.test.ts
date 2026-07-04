import { describe, expect, test } from 'bun:test';

import { stripCommands } from '../src/hub/voice-transcription-segmenter';

describe('voice transcription command stripping', () => {
  test('detects sleep phrase variants and removes them from transcript text', () => {
    expect(stripCommands("that's it").sleep).toBe(true);
    expect(stripCommands('thats it').sleep).toBe(true);
    expect(stripCommands('that is it').sleep).toBe(true);
    expect(stripCommands("write this down that's it").text).toBe('write this down');
    expect(stripCommands("write this down, that's it").text).toBe('write this down');
  });

  test('detects patch, clipboard, and abort commands', () => {
    expect(stripCommands('patch me in').patch).toBe(true);
    expect(stripCommands('can you transcribe').clipboard).toBe(true);
    for (const phrase of ['ok stop', 'ok, stop', 'okay stop', 'okay, stop']) {
      expect(stripCommands(phrase).abort).toBe(true);
      expect(stripCommands(`keep this ${phrase}`).text).toBe('keep this');
      expect(stripCommands(`keep this, ${phrase}`).text).toBe('keep this');
    }
  });

  test('detects lock phrase separately from prompt sleep commands', () => {
    const command = stripCommands('go to sleep');
    expect(command.lock).toBe(true);
    expect(command.sleep).toBe(false);
    expect(command.text).toBe('');
  });

  test('does not treat common non-command text as sleep in the shared stripper', () => {
    const command = stripCommands('thank you');
    expect(command.sleep).toBe(false);
    expect(command.text).toBe('thank you');
  });

});
