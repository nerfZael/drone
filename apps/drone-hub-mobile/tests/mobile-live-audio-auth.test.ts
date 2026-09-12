import { expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { answerLiveAudioOffer, createLiveAudioOffer } from '@drone/device-protocol';
import { verifyP256Signature } from '../src/security/p256-signature';

test('mobile identity verification authenticates the Hub audio answer and rejects a substituted key', () => {
  const hub = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = hub.publicKey.export({ format: 'jwk' });
  const ids = { sourceDeviceId: 'phone', targetDeviceId: 'hub', sessionId: 'voice' };
  const mobile = createLiveAudioOffer(ids, crypto.randomBytes(48), (text, signature) =>
    verifyP256Signature(publicKey, text, signature),
  );
  const response = answerLiveAudioOffer(ids, mobile.offer, crypto.randomBytes(48), (text) =>
    crypto
      .sign('sha256', Buffer.from(text), { key: hub.privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url'),
  );
  expect(() => mobile.finish({ ...response.answer, publicKey: mobile.offer.publicKey })).toThrow(
    'Invalid Hub',
  );
  const auth = mobile.finish(response.answer);
  expect(
    response.auth.verify(auth.protect({ ...ids, sequence: 0, pcm: new Uint8Array([1, 2]) })),
  ).toBe(true);
});
