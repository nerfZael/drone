import { expect, test } from 'bun:test';
import { MeshLiveAudioRouter } from '../src/hub/device-mesh/mesh-live-audio-router';
import type { DeviceHttpChannel } from '../src/hub/device-mesh/device-http-channel';
import {
  createLiveAudioOffer,
  answerLiveAudioOffer,
  type LiveAudioFrame,
} from '@drone/device-protocol';
import { randomBytes } from 'node:crypto';

function negotiate(sessionId = 'live', sourceDeviceId = 'phone') {
  const ids = { sourceDeviceId, targetDeviceId: 'hub', sessionId };
  const phone = createLiveAudioOffer(ids, randomBytes(48), () => true);
  const hub = answerLiveAudioOffer(ids, phone.offer, randomBytes(48), () => 'test');
  return { hub, phone: phone.finish(hub.answer) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function channel() {
  const frames: LiveAudioFrame[] = [];
  let closed = false;
  const ws = {
    async ensureLiveAudio() {},
    async sendLiveAudio(frame: LiveAudioFrame) {
      frames.push(frame);
    },
    closeLiveAudio() {
      closed = true;
    },
  } as unknown as DeviceHttpChannel;
  return { ws, frames, closed: () => closed };
}
const frame = (sequence = 0): LiveAudioFrame => ({
  sourceDeviceId: 'phone',
  targetDeviceId: 'hub',
  sessionId: 'live',
  sequence,
  pcm: new Uint8Array([1, 2]),
});

test('routes both audio directions only through the hops that opened the session', async () => {
  const router = new MeshLiveAudioRouter();
  const phone = channel();
  const hub = channel();
  const attacker = channel();
  await router.open('phone', 'hub', 'live', phone.ws, hub.ws);
  router.receive(phone.ws, frame());
  await tick();
  expect(hub.frames).toEqual([frame()]);
  router.receive(hub.ws, { ...frame(), sourceDeviceId: 'hub', targetDeviceId: 'phone' });
  await tick();
  expect(phone.frames).toHaveLength(1);
  router.receive(attacker.ws, frame(1));
  expect(attacker.closed()).toBe(true);
  expect(hub.frames).toHaveLength(1);
  router.disconnect(hub.ws);
  expect(hub.frames.at(-1)?.aborted).toBe(true);
  router.receive(phone.ws, frame(1));
  await tick();
  expect(hub.frames).toHaveLength(2);
  router.close();
});

test('local streams reject replays and are retired on replacement, revoke and close during setup', async () => {
  const router = new MeshLiveAudioRouter();
  const phone = channel();
  let closed = 0;
  const received: string[] = [];
  const auth = negotiate();
  const endpoint = await router.open('phone', 'hub', 'live', phone.ws, undefined, auth.hub);
  endpoint.onAudio((audio) => received.push(audio));
  endpoint.onClose(() => closed++);
  expect(await router.open('phone', 'hub', 'live', phone.ws, undefined, auth.hub)).toBe(endpoint);
  router.receive(phone.ws, auth.phone.protect(frame()));
  await tick();
  expect(received).toEqual(['AQI=']);
  router.receive(phone.ws, auth.phone.protect(frame()));
  expect(phone.closed()).toBe(false);
  expect(closed).toBe(1);
  const replacement = await router.open(
    'phone',
    'hub',
    'new',
    phone.ws,
    undefined,
    negotiate('new').hub,
  );
  replacement.onClose(() => closed++);
  router.receive(phone.ws, frame(1));
  await tick();
  expect(received).toHaveLength(1);
  router.revoke('phone');
  expect(closed).toBe(2);
  let release!: () => void;
  phone.ws.ensureLiveAudio = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = router.open(
    'phone',
    'hub',
    'pending',
    phone.ws,
    undefined,
    negotiate('pending').hub,
  );
  router.closeSession('phone', 'hub', 'pending');
  release();
  await expect(pending).rejects.toThrow('cancelled');
  router.close();
});

test('relay directions run independently; congestion terminates only the affected session', async () => {
  const router = new MeshLiveAudioRouter();
  const phone = channel();
  const hub = channel();
  let release!: () => void;
  hub.ws.sendLiveAudio = (frame, active = () => true) =>
    frame.closed || frame.aborted || frame.sessionId === 'other'
      ? (hub.frames.push(frame), Promise.resolve())
      : new Promise((resolve) => {
          release = () => {
            if (active()) hub.frames.push(frame);
            resolve();
          };
        });
  await router.open('phone', 'hub', 'live', phone.ws, hub.ws);
  await router.open('other-phone', 'hub', 'other', phone.ws, hub.ws);
  for (let i = 0; i < 4; i++)
    router.receive(phone.ws, { ...frame(i), pcm: new Uint8Array(24_000) });
  await tick();
  router.receive(hub.ws, { ...frame(), sourceDeviceId: 'hub', targetDeviceId: 'phone' });
  await tick();
  expect(phone.frames).toHaveLength(1); // Output is not waiting for stalled input.
  router.receive(phone.ws, { ...frame(4), pcm: new Uint8Array(24_000) });
  expect(phone.closed()).toBe(false);
  expect(hub.closed()).toBe(false);
  expect(phone.frames.at(-1)?.aborted).toBe(true);
  router.receive(phone.ws, { ...frame(), sourceDeviceId: 'other-phone', sessionId: 'other' });
  await tick();
  expect(hub.frames.at(-1)?.sessionId).toBe('other');
  release();
  await tick();
  expect(hub.frames.filter((frame) => frame.sessionId === 'live' && !frame.aborted)).toEqual([]);
  router.close();
});

test('hop abort can overtake start, but a different peer cannot retire that session', async () => {
  const router = new MeshLiveAudioRouter();
  const phone = channel();
  const attacker = channel();
  const closed = { ...frame(), aborted: true, pcm: new Uint8Array() };
  router.receive(attacker.ws, closed);
  const endpoint = await router.open('phone', 'hub', 'live', phone.ws, undefined, negotiate().hub);
  endpoint.close();
  await expect(
    router.open('phone', 'hub', 'live', phone.ws, undefined, negotiate().hub),
  ).rejects.toThrow('already closed');
  router.receive(phone.ws, { ...closed, sessionId: 'late' });
  await expect(
    router.open('phone', 'hub', 'late', phone.ws, undefined, negotiate('late').hub),
  ).rejects.toThrow('already closed');
  router.close();
});

test('a tampering relay cannot deliver modified PCM or a forged endpoint close; other sessions survive', async () => {
  const router = new MeshLiveAudioRouter();
  const relay = channel();
  const a = negotiate();
  const b = negotiate('other', 'other-phone');
  let closed = 0;
  let received = 0;
  const first = await router.open('phone', 'hub', 'live', relay.ws, undefined, a.hub);
  const other = await router.open('other-phone', 'hub', 'other', relay.ws, undefined, b.hub);
  first.onAudio(() => received++);
  first.onClose(() => closed++);
  other.onAudio(() => received++);
  router.receive(relay.ws, { ...a.phone.protect(frame()), pcm: new Uint8Array([3, 4]) });
  expect(closed).toBe(1);
  expect(relay.closed()).toBe(false);
  expect(a.phone.verify(relay.frames[0])).toBe(true);
  router.receive(
    relay.ws,
    b.phone.protect({ ...frame(), sourceDeviceId: 'other-phone', sessionId: 'other' }),
  );
  await tick();
  expect(received).toBe(1);
  other.onClose(() => closed++);
  router.receive(relay.ws, {
    ...frame(),
    sourceDeviceId: 'other-phone',
    sessionId: 'other',
    closed: true,
    pcm: new Uint8Array(),
  });
  expect(closed).toBe(2); // It fails authentication; never accepted as an endpoint close.
  expect(relay.closed()).toBe(false);
  router.close();
});

test('relay preserves authenticated terminal bytes and bypasses a pending media send', async () => {
  const router = new MeshLiveAudioRouter();
  const phone = channel();
  const hub = channel();
  const auth = negotiate();
  let release!: () => void;
  hub.ws.sendLiveAudio = (frame) =>
    frame.closed
      ? (hub.frames.push(frame), Promise.resolve())
      : new Promise((resolve) => {
          release = resolve;
        });
  await router.open('phone', 'hub', 'live', phone.ws, hub.ws);
  router.receive(phone.ws, auth.phone.protect(frame()));
  await tick();
  const terminal = auth.phone.protect({
    ...frame(),
    closed: true,
    sequence: Number.MAX_SAFE_INTEGER,
    pcm: new Uint8Array(),
  });
  router.receive(phone.ws, terminal);
  expect(hub.frames).toEqual([terminal]);
  expect(auth.hub.auth.verify(hub.frames[0])).toBe(true);
  expect(phone.closed()).toBe(false);
  release();
  router.close();
});
