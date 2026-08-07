import { describe, expect, test } from 'bun:test';
import {
  ContinuousVoiceSegmenter,
  normalizePcm16Audio,
  pcm16ToWaveBytes,
} from '../src/continuous-voice';

function pcm(milliseconds: number, amplitude: number, sampleRate = 16_000): Int16Array {
  const output = new Int16Array(Math.round((milliseconds * sampleRate) / 1_000));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return output;
}

describe('ContinuousVoiceSegmenter', () => {
  test('does not submit indefinite silence or a short noise', () => {
    const segmenter = new ContinuousVoiceSegmenter({ silenceMillis: 500 });
    expect(segmenter.push(pcm(2_000, 20)).segments).toEqual([]);
    expect(segmenter.push(pcm(100, 8_000)).segments).toEqual([]);
    expect(segmenter.push(pcm(1_000, 20)).segments).toEqual([]);
    expect(segmenter.flush()).toBeNull();
  });

  test('ends a valid thought after configured silence and trims the wait', () => {
    const segmenter = new ContinuousVoiceSegmenter({
      silenceMillis: 500,
      preRollMillis: 100,
      trailingMillis: 100,
      minimumSpeechMillis: 200,
    });
    segmenter.push(pcm(200, 10));
    segmenter.push(pcm(600, 8_000));
    const result = segmenter.push(pcm(600, 10));
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.reason).toBe('silence');
    expect(result.segments[0]?.sequence).toBe(0);
    expect(result.segments[0]?.durationMillis).toBeGreaterThanOrEqual(780);
    expect(result.segments[0]?.durationMillis).toBeLessThanOrEqual(820);
  });

  test('keeps one thought when speech resumes during the pause', () => {
    const segmenter = new ContinuousVoiceSegmenter({ silenceMillis: 500, trailingMillis: 100 });
    segmenter.push(pcm(500, 8_000));
    expect(segmenter.push(pcm(300, 10)).segments).toEqual([]);
    segmenter.push(pcm(500, 8_000));
    const result = segmenter.push(pcm(600, 10));
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.durationMillis).toBeGreaterThan(1_300);
  });

  test('forces a bounded segment and maintains sequence numbers', () => {
    const segmenter = new ContinuousVoiceSegmenter({
      maximumSegmentMillis: 1_000,
      minimumSpeechMillis: 100,
      silenceMillis: 300,
    });
    const first = segmenter.push(pcm(1_100, 8_000)).segments;
    expect(first[0]?.reason).toBe('maximum-duration');
    segmenter.push(pcm(400, 8_000));
    const second = segmenter.push(pcm(400, 10)).segments;
    expect(second[0]?.sequence).toBe(1);
  });

  test('adapts to steady room noise without submitting it as speech', () => {
    const segmenter = new ContinuousVoiceSegmenter({ silenceMillis: 400 });
    for (let index = 0; index < 20; index += 1) {
      expect(segmenter.push(pcm(100, 220)).segments).toEqual([]);
    }
    segmenter.push(pcm(500, 6_000));
    const result = segmenter.push(pcm(500, 220));
    expect(result.segments).toHaveLength(1);
  });

  test('flushes valid speech but drops an unfinished short sound', () => {
    const valid = new ContinuousVoiceSegmenter({ minimumSpeechMillis: 200 });
    valid.push(pcm(350, 7_000));
    expect(valid.flush()?.reason).toBe('flush');

    const short = new ContinuousVoiceSegmenter({ minimumSpeechMillis: 300 });
    short.push(pcm(100, 7_000));
    expect(short.flush()).toBeNull();
  });
});

test('normalizes stereo PCM and sample rate', () => {
  const input = new Int16Array([10_000, -10_000, 8_000, 4_000, -6_000, -2_000, 2_000, 6_000]);
  const output = normalizePcm16Audio({ pcm: input, sampleRate: 8_000, channels: 2, targetSampleRate: 16_000 });
  expect(output.length).toBe(8);
  expect(output[0]).toBe(0);
  expect(output[2]).toBe(6_000);
});

test('encodes a valid PCM wave header', () => {
  const bytes = pcm16ToWaveBytes(new Int16Array([1, -1, 2, -2]));
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
  expect(bytes.length).toBe(52);
});
