import { describe, expect, test } from 'bun:test';
import { floatToPcm16, mergeDraftWithVoiceTranscript, pcm16ToWav } from '../src/droneHub/chat/use-chat-voice-recorder';

function readAscii(view: DataView, offset: number, length: number): string {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += String.fromCharCode(view.getUint8(offset + index));
  }
  return output;
}

describe('chat voice recorder helpers', () => {
  test('merges voice transcript below existing draft text', () => {
    expect(mergeDraftWithVoiceTranscript('', ' hello world ')).toBe('hello world');
    expect(mergeDraftWithVoiceTranscript('existing draft  ', 'new transcript')).toBe('existing draft\nnew transcript');
    expect(mergeDraftWithVoiceTranscript('existing draft', '   ')).toBe('existing draft');
  });

  test('encodes pcm16 audio as a wav upload', () => {
    const pcm = floatToPcm16(new Float32Array([-1, 0, 1]));
    const wav = pcm16ToWav(pcm, 16_000, 1);
    const view = new DataView(wav);

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  });
});
