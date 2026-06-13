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

export function wavPcm16Data(wav: Uint8Array): { pcm: Uint8Array; sampleRate: number; channels: number } {
  if (wav.byteLength < 44 || ascii(wav, 0, 4) !== 'RIFF' || ascii(wav, 8, 4) !== 'WAVE') {
    throw new Error('audio must be a WAV file');
  }

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  let formatCode = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= wav.byteLength) {
    const chunkId = ascii(wav, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    if (chunkSize === 0xffffffff || chunkDataStart + chunkSize > wav.byteLength) {
      throw new Error('WAV file has an invalid chunk size');
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error('WAV fmt chunk is too short');
      formatCode = view.getUint16(chunkDataStart, true);
      channels = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);
    } else if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (formatCode !== 1) throw new Error('WAV file must use PCM audio');
  if (bitsPerSample !== 16) throw new Error('WAV file must use 16-bit samples');
  if (sampleRate !== 16_000) throw new Error('WAV file must use a 16 kHz sample rate');
  if (channels !== 1) throw new Error('WAV file must be mono');
  if (dataStart < 0) throw new Error('WAV file is missing audio data');

  return {
    pcm: wav.slice(dataStart, dataStart + dataSize),
    sampleRate,
    channels,
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
