import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { WorkspaceUploadSink } from '@drone/device-protocol';

export async function createWorkspaceUploadSink(): Promise<WorkspaceUploadSink> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-http-upload-'));
  const file = await fs.open(path.join(directory, 'body'), 'wx+');
  let closed = false;
  return {
    async write(bytes) {
      await file.writeFile(bytes);
    },
    async finish(ticket, offset, signal, skipBytes = 0) {
      await file.sync();
      const response = await fetch(ticket.url, {
        method: 'PUT',
        redirect: 'error',
        signal,
        headers: {
          authorization: `Bearer ${ticket.token}`,
          'x-upload-offset': String(offset),
          'content-type': 'application/octet-stream',
        },
        body: Readable.toWeb(file.createReadStream({ start: skipBytes, autoClose: false })) as any,
        duplex: 'half',
      } as RequestInit);
      if (!response.ok) throw new Error(`Workspace upload failed (${response.status})`);
      return Number((await response.json()).offset);
    },
    async close() {
      if (closed) return;
      closed = true;
      await file.close();
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
