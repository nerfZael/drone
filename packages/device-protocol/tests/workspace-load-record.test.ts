import { expect, test } from 'bun:test';
import { normalizeMobileChatLoad } from '../src/chat-load-diagnostics';

test('accepts independent media records and validates their parent click identity', () => {
  const record = { version: 1, kind: 'media-load', navigationId: 'media-1', parentNavigationId: 'click-1',
    targetDeviceId: 'desktop', droneId: 'd', chatName: 'c', platform: 'web',
    startedAt: '2026-09-07T20:51:00Z', durationMs: 100, status: 'completed',
    milestones: { imageDecoded: 100 }, requests: [], path: '/private/image.png' };
  const normalized = normalizeMobileChatLoad(record);
  expect(normalized?.parentNavigationId).toBe('click-1');
  expect(normalized?.kind).toBe('media-load');
  expect(normalized).not.toHaveProperty('path');
  expect(normalizeMobileChatLoad({ ...record, parentNavigationId: 'bad\nvalue' })).not.toHaveProperty('parentNavigationId');
});
