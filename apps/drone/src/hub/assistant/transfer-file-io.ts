import type { FileHandle } from 'node:fs/promises';

export async function readTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<boolean> {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead <= 0) return false;
    read += result.bytesRead;
  }
  return true;
}

export async function writeTransferBytes(
  handle: FileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const result = await handle.write(
      buffer,
      written,
      buffer.length - written,
      position + written,
    );
    if (result.bytesWritten <= 0) throw new Error('destination stopped writing transfer data');
    written += result.bytesWritten;
  }
}
