/** Ephemeral PCM traffic, carried separately from durable mesh commands and SSE events. */
export const LIVE_AUDIO_PATH = '/api/device-mesh/v2/live-audio';
export const LIVE_AUDIO_TRANSPORT = 'mesh-pcm-v2';
export const LIVE_AUDIO_FRAME_BYTES = 24_000; // 500 ms of PCM16 mono at 24 kHz.
export const LIVE_AUDIO_QUEUE_BYTES = 96_000; // Two seconds of queued audio.
export type LiveAudioHeader = {
  sourceDeviceId: string;
  targetDeviceId: string;
  sessionId: string;
  sequence: number;
  closed?: boolean;
  aborted?: boolean; // Hop failure notification, never an endpoint-authenticated close.
  mac?: string;
};
export type LiveAudioFrame = LiveAudioHeader & { pcm: Uint8Array };
export type LiveAudioStream = { send(audio: string): Promise<void>; close(): void };
export type LiveAudioSocket = {
  readyState: number;
  bufferedAmount: number;
  binaryType: string;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: { data: any }) => void) | null;
  onclose: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  send(data: any): void;
  close(): void;
};

export function encodeLiveAudioFrame(frame: LiveAudioFrame): Uint8Array {
  const { pcm, ...header } = frame;
  const json = new TextEncoder().encode(JSON.stringify(header));
  if (
    json.length > 1024 ||
    (!pcm.length && !frame.closed && !frame.aborted) ||
    (Boolean(frame.closed || frame.aborted) && pcm.length > 0) ||
    pcm.length > LIVE_AUDIO_FRAME_BYTES ||
    pcm.length % 2
  )
    throw new Error('Invalid Live audio frame');
  const result = new Uint8Array(4 + json.length + pcm.length);
  new DataView(result.buffer).setUint32(0, json.length);
  result.set(json, 4);
  result.set(pcm, 4 + json.length);
  return result;
}

export function decodeLiveAudioFrame(data: ArrayBuffer | Uint8Array): LiveAudioFrame {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 5 || bytes.length > LIVE_AUDIO_FRAME_BYTES + 1028)
    throw new Error('Invalid Live audio frame');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (!length || length > 1024 || length + 4 > bytes.length)
    throw new Error('Invalid Live audio header');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length)));
  for (const key of ['sourceDeviceId', 'targetDeviceId', 'sessionId']) {
    if (typeof header?.[key] !== 'string' || !header[key] || header[key].length > 200)
      throw new Error('Invalid Live audio identity');
  }
  if (!Number.isSafeInteger(header.sequence) || header.sequence < 0)
    throw new Error('Invalid Live audio sequence');
  const pcm = bytes.subarray(4 + length);
  if (
    pcm.length % 2 ||
    (!pcm.length && header.closed !== true && header.aborted !== true) ||
    (header.closed !== undefined && (header.closed !== true || pcm.length > 0)) ||
    (header.aborted !== undefined &&
      (header.aborted !== true || pcm.length > 0 || header.closed !== undefined)) ||
    (header.mac !== undefined &&
      (typeof header.mac !== 'string' || !/^[0-9a-f]{64}$/.test(header.mac)))
  )
    throw new Error('Invalid Live PCM');
  return {
    sourceDeviceId: header.sourceDeviceId,
    targetDeviceId: header.targetDeviceId,
    sessionId: header.sessionId,
    sequence: header.sequence,
    ...(header.closed === true ? { closed: true } : {}),
    ...(header.aborted === true ? { aborted: true } : {}),
    ...(header.mac !== undefined ? { mac: header.mac } : {}),
    pcm,
  };
}

/** Limits audio duration and frame work independently of platform capture chunk sizes. */
export class LiveAudioBudget {
  private bytes = 48_000 * 40; // Bounded opening speech may arrive after connection setup.
  private frames = 200;
  private updated: number;
  private sequence = -1;
  constructor(private readonly now = Date.now) {
    this.updated = now();
  }
  accept(frame: LiveAudioFrame): boolean {
    const now = this.now();
    const elapsed = Math.max(0, now - this.updated) / 1000;
    this.updated = now;
    this.bytes = Math.min(48_000 * 40, this.bytes + elapsed * 96_000);
    this.frames = Math.min(200, this.frames + elapsed * 100);
    if (frame.sequence !== this.sequence + 1 || frame.pcm.length > this.bytes || this.frames < 1)
      return false;
    this.sequence = frame.sequence;
    this.bytes -= frame.pcm.length;
    this.frames--;
    return true;
  }
}

// React Native does not consistently provide atob/btoa, and the native audio API uses base64.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function pcmFromBase64(audio: string): Uint8Array {
  if (!audio || audio.length > 256_000 || audio.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio))
    throw new Error('Invalid Live PCM');
  const bytes = new Uint8Array(
    (audio.length * 3) / 4 - (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0),
  );
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of audio) {
    if (char === '=') break;
    value = (value << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (value >> bits) & 255;
    }
  }
  if (!bytes.length || bytes.length % 2) throw new Error('Invalid Live PCM');
  return bytes;
}
export function pcmToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result +=
      alphabet[value >>> 18] +
      alphabet[(value >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return result;
}

export async function sendLiveAudioFrame(
  socket: LiveAudioSocket,
  frame: LiveAudioFrame,
  active: () => boolean = () => true,
): Promise<void> {
  // Termination has reserved space and bypasses queued media work.
  if (frame.closed || frame.aborted) {
    if (socket.readyState !== 1 || socket.bufferedAmount > LIVE_AUDIO_QUEUE_BYTES * 2)
      throw new Error('Live audio connection cannot deliver termination');
    socket.send(encodeLiveAudioFrame(frame));
    return;
  }
  const started = Date.now();
  while (
    active() &&
    socket.readyState === 1 &&
    socket.bufferedAmount + frame.pcm.length + 1028 > LIVE_AUDIO_QUEUE_BYTES
  ) {
    if (Date.now() - started > 2_000) throw new Error('Live audio connection is too slow');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!active()) return;
  if (socket.readyState !== 1) throw new Error('Live audio connection closed');
  socket.send(encodeLiveAudioFrame(frame));
}
