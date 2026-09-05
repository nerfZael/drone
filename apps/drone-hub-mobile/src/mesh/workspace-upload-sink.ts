import { throwIfAborted } from '@drone/device-protocol';
import type { WorkspaceUploadSink } from '@drone/device-protocol';
import { uploadNativeFile } from './native-http-upload';

export async function createWorkspaceUploadSink(): Promise<WorkspaceUploadSink> {
  const { File, FileMode, Paths } = await import('expo-file-system');
  const file = new File(
    Paths.cache,
    `workspace-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  let handleClosed = false;
  return {
    async write(bytes) {
      handle.writeBytes(bytes);
    },
    async finish(ticket, offset, signal, skipBytes = 0) {
      if (!handleClosed) {
        handle.close();
        handleClosed = true;
      }
      throwIfAborted(signal);
      let remainder: InstanceType<typeof File> | null = null;
      try {
        if (skipBytes) {
          if (skipBytes > file.size) throw new Error('Invalid upload resume offset');
          remainder = new File(
            Paths.cache,
            `workspace-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          );
          remainder.create();
          const source = file.open(FileMode.ReadOnly);
          const destination = remainder.open(FileMode.WriteOnly);
          try {
            source.offset = skipBytes;
            let remaining = file.size - skipBytes;
            while (remaining > 0) {
              throwIfAborted(signal);
              const bytes = source.readBytes(Math.min(64 * 1024, remaining));
              if (!bytes.length) throw new Error('Staged upload ended early');
              destination.writeBytes(bytes);
              remaining -= bytes.length;
            }
          } finally {
            source.close();
            destination.close();
          }
        }
        const response = await uploadNativeFile(
          ticket.url,
          (remainder ?? file).uri,
          {
            authorization: `Bearer ${ticket.token}`,
            'x-upload-offset': String(offset),
            'content-type': 'application/octet-stream',
          },
          signal,
        );
        return Number(response.offset);
      } finally {
        if (remainder?.exists) remainder.delete();
      }
    },
    async close() {
      if (!handleClosed) {
        handle.close();
        handleClosed = true;
      }
      if (file.exists) file.delete();
    },
  };
}
