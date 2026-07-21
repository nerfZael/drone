import { describe, expect, test } from 'bun:test';

import {
  computePrependedTranscriptScrollTop,
  isTranscriptPinned,
  shouldAutoFollowTranscript,
} from '../src/droneHub/chat/use-pinned-transcript-scroll';

describe('shared transcript scrolling', () => {
  test('treats a transcript near the bottom as pinned', () => {
    expect(
      isTranscriptPinned({
        scrollHeight: 1_000,
        scrollTop: 455,
        clientHeight: 500,
      }),
    ).toBe(true);
  });

  test('does not treat a transcript farther up as pinned', () => {
    expect(
      isTranscriptPinned({
        scrollHeight: 1_000,
        scrollTop: 400,
        clientHeight: 500,
      }),
    ).toBe(false);
  });

  test('honors a custom bottom threshold', () => {
    expect(
      isTranscriptPinned({
        scrollHeight: 1_000,
        scrollTop: 420,
        clientHeight: 500,
        threshold: 80,
      }),
    ).toBe(true);
  });

  test('preserves the visible messages when older content is prepended', () => {
    expect(
      computePrependedTranscriptScrollTop({
        previousScrollTop: 240,
        previousScrollHeight: 1_200,
        nextScrollHeight: 1_700,
        clientHeight: 600,
      }),
    ).toBe(740);
  });

  test('clamps a restored position to the available scroll range', () => {
    expect(
      computePrependedTranscriptScrollTop({
        previousScrollTop: 900,
        previousScrollHeight: 1_000,
        nextScrollHeight: 1_100,
        clientHeight: 500,
      }),
    ).toBe(600);
  });

  test('does not auto-follow while older messages are being prepended', () => {
    expect(
      shouldAutoFollowTranscript({
        enabled: true,
        pinned: true,
        preservingPrepend: true,
      }),
    ).toBe(false);
  });

  test('auto-follows ordinary content changes while pinned', () => {
    expect(
      shouldAutoFollowTranscript({
        enabled: true,
        pinned: true,
        preservingPrepend: false,
      }),
    ).toBe(true);
  });
});
