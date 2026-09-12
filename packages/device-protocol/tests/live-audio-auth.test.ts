import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { p256 } from '@noble/curves/nist.js';
import { answerLiveAudioOffer, createLiveAudioOffer } from '../src/live-audio-auth';
import { LiveAudioClient } from '../src/live-audio-client';
import {
  decodeLiveAudioFrame,
  encodeLiveAudioFrame,
  LIVE_AUDIO_QUEUE_BYTES,
  type LiveAudioFrame,
  type LiveAudioSocket,
} from '../src/live-audio-stream';

const identity = { sourceDeviceId: 'phone', targetDeviceId: 'hub', sessionId: 'live' };
const signing = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = signing.publicKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x!, 'base64url'),
  Buffer.from(jwk.y!, 'base64url'),
]);
const sign = (text: string) =>
  crypto
    .sign('sha256', Buffer.from(text), { key: signing.privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
// The mobile verifier accepts the same P1363 signatures as Node, including high S.
const verify = (text: string, signature: string) =>
  p256.verify(Buffer.from(signature, 'base64url'), new TextEncoder().encode(text), publicKey, {
    lowS: false,
    prehash: true,
  });
function handshake(sessionId = 'live') {
  const ids = { ...identity, sessionId };
  const phone = createLiveAudioOffer(ids, crypto.randomBytes(48), verify);
  const hub = answerLiveAudioOffer(ids, phone.offer, crypto.randomBytes(48), sign);
  return { phone, hub };
}
const input = (): LiveAudioFrame => ({ ...identity, sequence: 0, pcm: new Uint8Array([1, 2]) });
const output = (sessionId = 'live'): LiveAudioFrame => ({
  ...input(),
  sessionId,
  sourceDeviceId: 'hub',
  targetDeviceId: 'phone',
});
function socket() {
  const sent: LiveAudioFrame[] = [];
  const ws: LiveAudioSocket = {
    readyState: 1,
    bufferedAmount: 0,
    binaryType: 'arraybuffer',
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (bytes) => sent.push(decodeLiveAudioFrame(bytes)),
    close() {
      this.readyState = 3;
    },
  };
  return {
    ws,
    sent,
    receive: (frame: LiveAudioFrame) => ws.onmessage!({ data: encodeLiveAudioFrame(frame) }),
  };
}

test('endpoint keys interoperate and reject modified PCM, routing, sequence, terminal flags and reflected frames', () => {
  const { phone, hub } = handshake();
  const auth = phone.finish(hub.answer);
  const signed = auth.protect(input());
  expect(hub.auth.verify(signed)).toBe(true);
  expect(auth.verify(hub.auth.protect(output()))).toBe(true);
  for (const change of [
    { pcm: new Uint8Array([3, 4]) },
    { sequence: 1 },
    { sessionId: 'other' },
    { sourceDeviceId: 'attacker' },
    { targetDeviceId: 'attacker' },
    { mac: '0'.repeat(64) },
    { closed: true, pcm: new Uint8Array() },
    { aborted: true, pcm: new Uint8Array() },
  ])
    expect(hub.auth.verify({ ...signed, ...change })).toBe(false);
  expect(auth.verify({ ...signed, sourceDeviceId: 'hub', targetDeviceId: 'phone' })).toBe(false);
  expect(
    hub.auth.verify(
      auth.protect({
        ...input(),
        sequence: Number.MAX_SAFE_INTEGER,
        closed: true,
        pcm: new Uint8Array(),
      }),
    ),
  ).toBe(true);
  expect(handshake().hub.auth.verify(signed)).toBe(false);
  expect(() => phone.finish(hub.answer)).toThrow('already completed');
});

test('Hub authentication binds both ephemeral keys and endpoint/session identities', () => {
  for (const change of [
    { sourceDeviceId: 'relay' },
    { targetDeviceId: 'relay' },
    { sessionId: 'other' },
  ]) {
    const { phone } = handshake();
    const wrong = answerLiveAudioOffer(
      { ...identity, ...change },
      phone.offer,
      crypto.randomBytes(48),
      sign,
    );
    expect(() => phone.finish(wrong.answer)).toThrow('Invalid Hub');
  }
  const { phone, hub } = handshake();
  const unrelated = handshake();
  expect(() => phone.finish(unrelated.hub.answer)).toThrow('Invalid Hub');
  expect(() => phone.finish({ ...hub.answer, publicKey: unrelated.hub.answer.publicKey })).toThrow(
    'Invalid Hub',
  );
  const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const forged = answerLiveAudioOffer(identity, phone.offer, crypto.randomBytes(48), (text) =>
    crypto
      .sign('sha256', Buffer.from(text), { key: attacker.privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url'),
  );
  expect(() => phone.finish(forged.answer)).toThrow('Invalid Hub');
  expect(() => phone.finish({ ...hub.answer, suite: 'none' })).toThrow('authenticate');
  expect(() =>
    answerLiveAudioOffer(
      identity,
      { ...phone.offer, publicKey: '02' + 'f'.repeat(64) },
      crypto.randomBytes(48),
      sign,
    ),
  ).toThrow();
  expect(phone.finish(hub.answer).verify(hub.auth.protect(output()))).toBe(true);
});

test('Stop sends an authenticated terminal immediately, bypasses stalled audio, and leaves the shared socket open', async () => {
  const { phone, hub } = handshake();
  const s = socket();
  const client = new LiveAudioClient(s.ws, 'phone');
  const stream = client.open(
    'hub',
    'live',
    () => {},
    () => {},
    phone,
  );
  stream.accept(hub.answer);
  s.ws.bufferedAmount = LIVE_AUDIO_QUEUE_BYTES;
  const blocked = stream.send('AQI=');
  stream.close();
  stream.close();
  expect(s.sent).toHaveLength(1);
  expect(s.sent[0].closed).toBe(true);
  expect(hub.auth.verify(s.sent[0])).toBe(true);
  await blocked;
  expect(s.sent).toHaveLength(1);
  expect(s.ws.readyState).toBe(1);
});

test('Stop before the start answer sends only a signed terminal when authentication completes', async () => {
  const { phone, hub } = handshake();
  const s = socket();
  const stream = new LiveAudioClient(s.ws, 'phone').open(
    'hub',
    'live',
    () => {},
    () => {},
    phone,
  );
  stream.close();
  expect(s.sent).toEqual([]);
  stream.accept(hub.answer);
  await stream.send('AQI=');
  expect(s.sent).toHaveLength(1);
  expect(s.sent[0].closed).toBe(true);
  expect(hub.auth.verify(s.sent[0])).toBe(true);
});

test('early audio waits for the authenticated answer; bad audio ends only its own session', () => {
  const a = handshake('a');
  const b = handshake('b');
  const s = socket();
  const client = new LiveAudioClient(s.ws, 'phone');
  const played: string[] = [];
  const errors: string[] = [];
  const streamA = client.open(
    'hub',
    'a',
    () => played.push('a'),
    (error) => errors.push(error),
    a.phone,
  );
  const streamB = client.open(
    'hub',
    'b',
    () => played.push('b'),
    (error) => errors.push(error),
    b.phone,
  );
  s.receive(a.hub.auth.protect(output('a')));
  expect(played).toEqual([]);
  streamA.accept(a.hub.answer);
  streamB.accept(b.hub.answer);
  expect(played).toEqual(['a']);
  s.receive({
    ...a.hub.auth.protect({ ...output('a'), sequence: 1 }),
    pcm: new Uint8Array([3, 4]),
  });
  s.receive(b.hub.auth.protect(output('b')));
  expect(played).toEqual(['a', 'b']);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('authentication');
  expect(s.ws.readyState).toBe(1);
  expect(a.hub.auth.verify(s.sent[0])).toBe(true);
  streamB.close();
});
