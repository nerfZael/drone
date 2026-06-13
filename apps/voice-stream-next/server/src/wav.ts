export function pcm16ToWav(pcm: Uint8Array, sampleRate = 16_000, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

export function normalizeWavChunkSizes(wav: Uint8Array): Uint8Array {
  if (wav.byteLength < 12 || ascii(wav, 0, 4) !== 'RIFF' || ascii(wav, 8, 4) !== 'WAVE') {
    return wav;
  }

  const output = new Uint8Array(wav);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const riffSize = output.byteLength - 8;
  if (riffSize >= 0 && riffSize <= 0xffffffff && view.getUint32(4, true) === 0xffffffff) {
    view.setUint32(4, riffSize, true);
  }

  let offset = 12;
  while (offset + 8 <= output.byteLength) {
    const chunkId = ascii(output, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;

    if (chunkId === 'data') {
      if (chunkSize === 0xffffffff) {
        view.setUint32(offset + 4, output.byteLength - dataStart, true);
      }
      break;
    }

    if (chunkSize === 0xffffffff) break;

    const nextOffset = dataStart + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > output.byteLength) break;
    offset = nextOffset;
  }

  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
