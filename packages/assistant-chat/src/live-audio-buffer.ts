/** PCM16LE mono at 24 kHz. Keep the opening audio until Live can consume it. */
export class LiveAudioBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private ready = false;
  private closed = false;
  private draining = false;
  private muted = false;

  constructor(private readonly send: (audio: string) => Promise<void>,
    private readonly onError: (error: string) => void,
    private readonly maxBytes = 24_000 * 2 * 40,
    private readonly batchBytes = 24_000) {}

  append(audio: string): void {
    if (this.closed || !audio) return;
    if (this.muted) audio = audio.replace(/[A-Za-z0-9+/]/g, 'A');
    const bytes = audio.length * 3 / 4 - (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0);
    if (bytes > 24_000 || this.bytes + bytes > this.maxBytes) {
      this.close();
      this.onError('Live voice could not keep up with the microphone. Start a new conversation.');
      return;
    }
    this.chunks.push(audio);
    this.bytes += bytes;
    void this.drain();
  }

  connect(): void { this.ready = true; void this.drain(); }
  mute(muted: boolean): void {
    this.muted = muted;
    if (muted) { this.chunks = []; this.bytes = 0; }
  }
  close(): void { this.closed = true; this.chunks = []; this.bytes = 0; }

  private async drain(): Promise<void> {
    if (this.draining || !this.ready || this.closed) return;
    this.draining = true;
    try {
      while (!this.closed && this.chunks.length) {
        const batch: string[] = [];
        let bytes = 0;
        while (this.chunks.length) {
          const next = this.chunks[0];
          const length = next.length * 3 / 4 - (next.endsWith('==') ? 2 : next.endsWith('=') ? 1 : 0);
          if (batch.length && bytes + length > this.batchBytes) break;
          batch.push(this.chunks.shift()!);
          bytes += length;
        }
        this.bytes -= bytes;
        await this.send(joinLiveAudioChunks(batch));
      }
    } catch {
      if (!this.closed) {
        this.close();
        this.onError('Could not send microphone audio to Live. Start a new conversation.');
      }
    } finally { this.draining = false; }
  }
}

export type LivePcmAudio = {
  mute(muted: boolean): void;
  play(audio: string): void;
  resume(): Promise<void>;
  release(): Promise<void>;
};
export type LivePcmCallbacks = { signal?: AbortSignal; onAudio(audio: string): void; onError(error: string): void };

// Merge complete PCM chunks without concatenating padded base64 strings. Kept
// platform-neutral: React Native does not provide browser atob/btoa globals.
export function joinLiveAudioChunks(chunks: string[]): string {
  if (chunks.length === 1) return chunks[0];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (const chunk of chunks) {
    let bits = 0; let value = 0;
    for (const char of chunk) {
      if (char === '=') break;
      value = (value << 6) | alphabet.indexOf(char);
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    result += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=')
      + (i + 2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return result;
}
