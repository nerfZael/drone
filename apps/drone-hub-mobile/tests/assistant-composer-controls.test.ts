import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('mobile assistant composer controls', () => {
  test('only shows continuous dictation when expanded and places it before the microphone', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/AssistantComposer.tsx', import.meta.url),
      'utf8',
    );
    const collapsedStart = source.indexOf('{!expanded ? (');
    const expandedStart = source.indexOf('{expanded ? (', collapsedStart);
    const collapsedControls = source.slice(collapsedStart, expandedStart);
    const idleExpandedStart = source.indexOf("{voiceStatus === 'idle'", expandedStart);
    const activeVoiceStart = source.indexOf(') : continuousVoiceOwned ?', idleExpandedStart);
    const idleExpandedControls = source.slice(idleExpandedStart, activeVoiceStart);
    const continuousIconIndex = idleExpandedControls.indexOf('icon={AudioLines}');
    const microphoneIconIndex = idleExpandedControls.indexOf('icon={Mic}');

    expect(collapsedControls).not.toContain('Choose continuous voice mode');
    expect(idleExpandedControls).toContain('Choose continuous voice mode');
    expect(continuousIconIndex).toBeGreaterThan(-1);
    expect(microphoneIconIndex).toBeGreaterThan(-1);
    expect(continuousIconIndex).toBeLessThan(microphoneIconIndex);
  });
});
