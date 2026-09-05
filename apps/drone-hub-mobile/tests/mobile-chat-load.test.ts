import { afterEach, expect, test } from 'bun:test';
import { ChatLoadBuffer } from '../src/diagnostics/chat-load-buffer';
import {
  beginMobileChatLoad,
  configureMobileChatDiagnostics,
  finishMobileChatLoad,
  markMobileChatLoad,
  mobileChatApplied,
  mobileChatCommitted,
  observeMobileChatRequest,
} from '../src/diagnostics/mobile-chat-load';
import { normalizeMobileChatLoad, type MobileChatLoadRecord } from '@drone/device-protocol';

const target = { targetDeviceId: 'hub', droneId: 'drone', chatName: 'default' };
const record = (id: string): MobileChatLoadRecord => ({
  version: 1,
  navigationId: id,
  ...target,
  platform: 'android',
  startedAt: new Date().toISOString(),
  durationMs: 12,
  status: 'completed',
  milestones: {},
  requests: [],
});
afterEach(() => finishMobileChatLoad('superseded'));

test('persistent buffer bounds history, survives reopening, retries, and retains uploaded records', async () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  const buffer = new ChatLoadBuffer(storage);
  await Promise.all(Array.from({ length: 105 }, (_, i) => buffer.append(record(String(i)))));
  const reopened = new ChatLoadBuffer(storage);
  expect((await reopened.list()).length).toBe(100);
  await reopened.flush(async () => {
    throw new Error('offline');
  });
  expect((await reopened.list()).filter((r) => r.uploaded)).toHaveLength(0);
  await reopened.flush(async (_target, records) => {
    await reopened.append(record('during-upload'));
    return { accepted: records.map((r) => r.navigationId) };
  });
  const saved = await reopened.list();
  expect(saved.filter((r) => r.uploaded)).toHaveLength(9);
  expect(saved.at(-1)?.record.navigationId).toBe('during-upload');
  expect(saved.at(-1)?.uploaded).toBe(false);
});

test('navigation records cached/fresh commits, correlated requests and frame proxy', () => {
  const saved: MobileChatLoadRecord[] = [];
  const frames: FrameRequestCallback[] = [];
  const original = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => {
    frames.push(cb);
    return frames.length;
  };
  try {
    configureMobileChatDiagnostics({
      uuid: () => 'nav',
      platform: 'android',
      save: async (r) => {
        saved.push(r);
      },
    });
    beginMobileChatLoad(target);
    markMobileChatLoad(target, 'readRequested');
    mobileChatCommitted(mobileChatApplied(target, 'cached'));
    while (frames.length) frames.shift()!(0);
    expect(observeMobileChatRequest('other', 'chat.read', target, 'bad')).toBeNull();
    const request = observeMobileChatRequest('hub', 'chat.read', target, 'request');
    request?.mark('signedMs');
    request?.timing('fetchMs', 3);
    request?.serverId('server');
    request?.finish('completed');
    mobileChatCommitted(mobileChatApplied(target, 'fresh'));
    expect(saved).toHaveLength(0);
    while (frames.length) frames.shift()!(0);
    expect(saved[0]?.status).toBe('completed');
    expect(saved[0]?.milestones.cachedFrame).toBeNumber();
    expect(saved[0]?.milestones.freshFrame).toBeNumber();
    expect(saved[0]?.requests[0]?.serverRequestId).toBe('server');
  } finally {
    globalThis.requestAnimationFrame = original;
  }
});

test('superseded navigation cannot be completed by a stale frame callback', () => {
  const saved: MobileChatLoadRecord[] = [];
  let id = 0;
  configureMobileChatDiagnostics({
    uuid: () => String(++id),
    platform: 'android',
    save: async (r) => {
      saved.push(r);
    },
  });
  beginMobileChatLoad(target);
  const token = mobileChatApplied(target, 'fresh');
  beginMobileChatLoad({ ...target, chatName: 'second' });
  mobileChatCommitted(token);
  finishMobileChatLoad('backgrounded');
  expect(saved.map((r) => r.status)).toEqual(['superseded', 'backgrounded']);
});

test('normalization rejects malformed records and strips payloads and unsafe timings', () => {
  expect(normalizeMobileChatLoad({ ...record('x'), durationMs: Infinity })).toBeNull();
  const normalized = normalizeMobileChatLoad({
    ...record('x'),
    sourceDeviceId: 'spoof',
    prompt: 'secret',
    milestones: { good: 1, bad: -1 },
    requests: [
      {
        requestId: 'request',
        operation: 'chat.read',
        outcome: 'completed',
        payload: 'secret',
        timings: { fetchMs: 12 },
      },
    ],
  });
  expect(normalized?.milestones).toEqual({ good: 1 });
  expect(JSON.stringify(normalized)).not.toContain('secret');
  expect(JSON.stringify(normalized)).not.toContain('spoof');
});
