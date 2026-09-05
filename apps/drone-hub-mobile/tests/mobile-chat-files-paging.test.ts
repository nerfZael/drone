import { describe, expect, test } from 'bun:test';
import {
  mobileChatFilesProgress,
  mobileChatFilesSnapOpen,
} from '../src/drones/mobile-chat-files-paging';

describe('chat and files paging', () => {
  test('moves one full screen left to reveal files and right to return to chat', () => {
    expect(mobileChatFilesProgress(0, -180, 360)).toBe(0.5);
    expect(mobileChatFilesProgress(0, -360, 360)).toBe(1);
    expect(mobileChatFilesProgress(1, 180, 360)).toBe(0.5);
    expect(mobileChatFilesProgress(1, 360, 360)).toBe(0);
  });

  test('clamps overswipes and can resume an interrupted transition', () => {
    expect(mobileChatFilesProgress(0, 100, 360)).toBe(0);
    expect(mobileChatFilesProgress(1, -100, 360)).toBe(1);
    expect(mobileChatFilesProgress(0.25, -90, 360)).toBe(0.5);
    expect(mobileChatFilesProgress(0, 0, 0)).toBe(0);
  });

  test('settles slow swipes to the nearest page', () => {
    expect(mobileChatFilesSnapOpen(0.49, 0)).toBe(false);
    expect(mobileChatFilesSnapOpen(0.51, 0)).toBe(true);
    expect(mobileChatFilesSnapOpen(0.25, -100)).toBe(false);
    expect(mobileChatFilesSnapOpen(0.75, 100)).toBe(true);
  });

  test('left and right flings choose files and chat regardless of the midpoint', () => {
    expect(mobileChatFilesSnapOpen(0.1, -500)).toBe(true);
    expect(mobileChatFilesSnapOpen(0.9, 500)).toBe(false);
  });
});
