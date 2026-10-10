import { throwIfAborted } from '@drone/device-protocol';
import { fetch as streamingFetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';

/**
 * Reads the bytes a `file.preview` media result points at: the phone's own file
 * when the phone is the target, otherwise the HTTP transfer the device authorized.
 */
export async function readPreviewMediaBytes(input: {
  result: any;
  phoneTarget: boolean;
  totalBytes: number;
  signal: AbortSignal;
  append: (bytes: Uint8Array) => void;
  onTransferStarted?: () => void;
  onTransferFinished?: () => void;
}): Promise<void> {
  const { result, totalBytes, signal, append } = input;
  let offset = 0;
  if (result?.localFileUri && input.phoneTarget) {
    const localHandle = new File(String(result.localFileUri)).open(FileMode.ReadOnly);
    try {
      while (offset < totalBytes) {
        throwIfAborted(signal);
        const bytes = localHandle.readBytes(Math.min(64 * 1024, totalBytes - offset));
        if (!bytes.length) throw new Error('Phone preview ended early');
        append(bytes);
        offset += bytes.length;
      }
    } finally {
      localHandle.close();
    }
    return;
  }
  const transfer = result?.transfer;
  if (!transfer?.url || !transfer?.token) throw new Error('The device did not authorize an HTTP download');
  input.onTransferStarted?.();
  const response = await streamingFetch(transfer.url, {
    headers: { authorization: 'Bearer ' + transfer.token },
    signal,
    redirect: 'error',
  });
  if (!response.ok || !response.body) throw new Error('HTTP download failed (' + response.status + ')');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      throwIfAborted(signal);
      if (value) {
        if (offset + value.byteLength > totalBytes) throw new Error('Download exceeds declared size');
        append(value);
        offset += value.byteLength;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (offset !== totalBytes) throw new Error('The HTTP download was incomplete');
  input.onTransferFinished?.();
}
