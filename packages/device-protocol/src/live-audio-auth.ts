import { p256 } from '@noble/curves/nist.js';
import { equalBytes } from '@noble/curves/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { encodeLiveAudioFrame, type LiveAudioFrame } from './live-audio-stream';

export const LIVE_AUDIO_AUTH_SUITE = 'P256-HKDF-SHA256-HMAC-SHA256';
export type LiveAudioOffer = { suite: typeof LIVE_AUDIO_AUTH_SUITE; publicKey: string };
export type LiveAudioAnswer = LiveAudioOffer & { signature: string };
export type LiveAudioIdentity = {
  sourceDeviceId: string;
  targetDeviceId: string;
  sessionId: string;
};

function publicKey(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^(02|03)[0-9a-f]{64}$/.test(value))
    throw new Error('Invalid Live audio key');
  const bytes = hexToBytes(value);
  p256.Point.fromBytes(bytes).assertValidity();
  return bytes;
}
function transcript(
  identity: LiveAudioIdentity,
  offer: LiveAudioOffer,
  answer: LiveAudioOffer,
): string {
  return JSON.stringify([
    'drone-live-audio-key-exchange-v2',
    LIVE_AUDIO_AUTH_SUITE,
    identity.sourceDeviceId,
    identity.targetDeviceId,
    identity.sessionId,
    offer.publicKey,
    answer.publicKey,
  ]);
}
function derive(secret: Uint8Array, remote: Uint8Array, text: string) {
  const shared = p256.getSharedSecret(secret, remote, true).subarray(1);
  try {
    const salt = sha256(new TextEncoder().encode(text));
    return {
      input: hkdf(sha256, shared, salt, new TextEncoder().encode('phone-to-hub'), 32),
      output: hkdf(sha256, shared, salt, new TextEncoder().encode('hub-to-phone'), 32),
    };
  } finally {
    secret.fill(0);
    shared.fill(0);
  }
}

/** Keys are private to the endpoints. Neither PCM nor terminal frames trust relay claims. */
export class LiveAudioFrameAuth {
  constructor(
    private readonly local: string,
    private readonly remote: string,
    private readonly session: string,
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
  ) {}
  private bytes(frame: LiveAudioFrame): Uint8Array {
    // Encode only defined protocol fields; extra JSON fields cannot alter authentication.
    return encodeLiveAudioFrame({
      sourceDeviceId: frame.sourceDeviceId,
      targetDeviceId: frame.targetDeviceId,
      sessionId: frame.sessionId,
      sequence: frame.sequence,
      ...(frame.closed ? { closed: true } : {}),
      pcm: frame.pcm,
    });
  }
  protect(frame: LiveAudioFrame): LiveAudioFrame {
    if (
      frame.aborted ||
      frame.sourceDeviceId !== this.local ||
      frame.targetDeviceId !== this.remote ||
      frame.sessionId !== this.session
    )
      throw new Error('Wrong Live audio signing context');
    return { ...frame, mac: bytesToHex(hmac(sha256, this.sendKey, this.bytes(frame))) };
  }
  verify(frame: LiveAudioFrame): boolean {
    if (
      frame.aborted ||
      frame.sourceDeviceId !== this.remote ||
      frame.targetDeviceId !== this.local ||
      frame.sessionId !== this.session ||
      !/^[0-9a-f]{64}$/.test(frame.mac ?? '')
    )
      return false;
    try {
      return equalBytes(hexToBytes(frame.mac!), hmac(sha256, this.receiveKey, this.bytes(frame)));
    } catch {
      return false;
    }
  }
}

export function createLiveAudioOffer(
  identity: LiveAudioIdentity,
  randomSeed: Uint8Array,
  verifyHub: (text: string, signature: string) => boolean,
) {
  const secret = p256.utils.randomSecretKey(randomSeed);
  const offer: LiveAudioOffer = {
    suite: LIVE_AUDIO_AUTH_SUITE,
    publicKey: bytesToHex(p256.getPublicKey(secret, true)),
  };
  let finished = false;
  return {
    offer,
    finish(value: unknown): LiveAudioFrameAuth {
      if (finished) throw new Error('Live audio key exchange already completed');
      const answer = value as LiveAudioAnswer;
      if (answer?.suite !== LIVE_AUDIO_AUTH_SUITE || typeof answer.signature !== 'string')
        throw new Error('Hub did not authenticate the Live audio stream');
      const remote = publicKey(answer.publicKey);
      const text = transcript(identity, offer, answer);
      if (!verifyHub(text, answer.signature)) throw new Error('Invalid Hub Live audio signature');
      finished = true;
      const keys = derive(secret, remote, text);
      return new LiveAudioFrameAuth(
        identity.sourceDeviceId,
        identity.targetDeviceId,
        identity.sessionId,
        keys.input,
        keys.output,
      );
    },
  };
}

/** Call only after verifying the signed live.start request containing this offer. */
export function answerLiveAudioOffer(
  identity: LiveAudioIdentity,
  value: unknown,
  randomSeed: Uint8Array,
  signHub: (text: string) => string,
): { answer: LiveAudioAnswer; auth: LiveAudioFrameAuth } {
  const offer = value as LiveAudioOffer;
  if (offer?.suite !== LIVE_AUDIO_AUTH_SUITE)
    throw new Error('Authenticated Live audio requires a key offer');
  const remote = publicKey(offer.publicKey);
  const secret = p256.utils.randomSecretKey(randomSeed);
  const response: LiveAudioOffer = {
    suite: LIVE_AUDIO_AUTH_SUITE,
    publicKey: bytesToHex(p256.getPublicKey(secret, true)),
  };
  const text = transcript(identity, offer, response);
  const answer = { ...response, signature: signHub(text) };
  const keys = derive(secret, remote, text);
  return {
    answer,
    auth: new LiveAudioFrameAuth(
      identity.targetDeviceId,
      identity.sourceDeviceId,
      identity.sessionId,
      keys.output,
      keys.input,
    ),
  };
}
