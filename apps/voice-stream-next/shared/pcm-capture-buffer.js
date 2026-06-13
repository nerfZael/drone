class PcmCaptureBuffer {
  constructor(maxBytes) {
    this.maxBytes = Math.max(0, maxBytes);
    this.chunks = [];
    this.totalBytes = 0;
  }

  get byteLength() {
    return this.totalBytes;
  }

  push(chunk) {
    const bytes = chunk?.byteLength ?? 0;
    if (bytes <= 0 || this.maxBytes <= 0) return;
    this.chunks.push(chunk.slice(0));
    this.totalBytes += bytes;
    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.totalBytes -= removed.byteLength;
    }
  }

  pushAll(chunks) {
    for (const chunk of chunks) {
      this.push(chunk);
    }
  }

  drain() {
    const output = this.chunks.slice();
    this.chunks = [];
    this.totalBytes = 0;
    return output;
  }

  clear() {
    this.chunks = [];
    this.totalBytes = 0;
  }
}

function pcmBytesForMs(ms, sampleRateHz = 16000) {
  return Math.max(0, Math.round(sampleRateHz * 2 * ms / 1000));
}

if (typeof globalThis !== 'undefined') {
  globalThis.PcmCaptureBuffer = PcmCaptureBuffer;
  globalThis.pcmBytesForMs = pcmBytesForMs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PcmCaptureBuffer, pcmBytesForMs };
}
