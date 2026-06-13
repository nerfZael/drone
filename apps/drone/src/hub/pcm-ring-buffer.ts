export class PcmRingBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get byteLength(): number {
    return this.totalBytes;
  }

  push(chunk: Buffer): void {
    if (this.maxBytes <= 0 || chunk.byteLength <= 0) return;
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.totalBytes -= removed.byteLength;
    }
  }

  drain(): Buffer[] {
    const output = this.chunks.slice();
    this.chunks = [];
    this.totalBytes = 0;
    return output;
  }

  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
  }
}
