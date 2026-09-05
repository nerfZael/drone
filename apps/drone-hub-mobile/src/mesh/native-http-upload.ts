import { throwIfAborted } from '@drone/device-protocol';
/** Upload directly from disk without Expo fetch's whole-body Blob/stream conversion. */
export async function uploadNativeFile(
  url: string,
  uri: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<any> {
  throwIfAborted(signal);
  const { createUploadTask, FileSystemUploadType } = await import('expo-file-system/legacy');
  throwIfAborted(signal);
  const task = createUploadTask(url, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  const abort = () => {
    void task.cancelAsync().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await task.uploadAsync();
    throwIfAborted(signal);
    if (!response || response.status < 200 || response.status >= 300)
      throw new Error(`HTTP upload failed (${response?.status ?? 'cancelled'})`);
    return JSON.parse(response.body);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
