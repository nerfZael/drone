import { expect, test } from 'bun:test';
import { createHttpWorkspaceAdapter } from '../src/http-workspace-adapter';

test('an early commit preserves staging and overlapping writes are rejected', async () => {
  let finishWrite!: () => void;
  let started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finishes = 0;
  const destination = createHttpWorkspaceAdapter({
    read: false,
    write: true,
    request: async () => ({
      offset: 0,
      upload: { url: 'https://peer/file', token: 'secret', size: 2 },
    }),
    createSink: async () => ({
      write: async () => {
        started();
        await new Promise<void>((resolve) => {
          finishWrite = resolve;
        });
      },
      finish: async () => {
        finishes++;
        return 2;
      },
      close: async () => {},
    }),
  }).destination!;
  const input = { transferId: 'a', path: 'f', size: 2 };
  await destination.prepareFile(input);
  await expect(destination.commitFile(input)).rejects.toThrow('incomplete');
  expect(finishes).toBe(0);
  const write = { transferId: 'a', offset: 0, dataBase64: 'AQI=' };
  const pending = destination.writeChunk(write);
  await writing;
  await expect(destination.writeChunk(write)).rejects.toThrow('already in progress');
  await expect(destination.abortFile(input)).rejects.toThrow('already in progress');
  finishWrite();
  await pending;
  await destination.commitFile(input);
  expect(finishes).toBe(1);
});

test('a reused download obeys the current caller cancellation and rejects overlapping reads', async () => {
  let cancelled = false;
  const source = createHttpWorkspaceAdapter({
    read: true,
    write: false,
    request: async () => ({ download: { url: 'https://peer/file', token: 'secret', size: 2 } }),
    createSink: async () => {
      throw new Error('unused');
    },
    fetchImpl: (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as typeof fetch,
  }).source!;
  expect((await source.readChunk('a', 0, 1)).bytes).toBe(1);
  const abort = new AbortController();
  const pending = source.readChunk('a', 1, 1, abort.signal);
  await expect(source.readChunk('a', 1, 1)).rejects.toThrow('already being read');
  abort.abort();
  await expect(pending).rejects.toThrow();
  expect(cancelled).toBe(true);
});

test('download admission counts requests still opening their HTTP bodies', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = createHttpWorkspaceAdapter({
    read: true,
    write: false,
    request: async () => {
      await gate;
      return { download: { url: 'https://peer/file', token: 'secret', size: 1 } };
    },
    createSink: async () => {
      throw new Error('unused');
    },
    fetchImpl: (async () => new Response(new Uint8Array([1]))) as typeof fetch,
  }).source!;
  const pending = Array.from({ length: 16 }, (_, i) => source.readChunk(String(i), 0, 1));
  await expect(source.readChunk('overflow', 0, 1)).rejects.toThrow('Too many');
  release();
  await Promise.all(pending);
  expect((await source.readChunk('fresh', 0, 1)).bytes).toBe(1);
});

test('a failed replacement sink leaves the existing staged upload usable', async () => {
  let allocations = 0;
  let closed = 0;
  const adapter = createHttpWorkspaceAdapter({
    read: false,
    write: true,
    request: async () => ({
      offset: 0,
      upload: { url: 'https://peer/file', token: 'secret', size: 2 },
    }),
    createSink: async () => {
      if (++allocations === 2) throw new Error('disk unavailable');
      return {
        write: async () => {},
        finish: async () => 2,
        close: async () => {
          closed++;
        },
      };
    },
  });
  const destination = adapter.destination!;
  const input = { transferId: 'a', path: 'f', size: 2 };
  await destination.prepareFile(input);
  await destination.writeChunk({ transferId: 'a', offset: 0, dataBase64: 'AQI=' });
  await expect(destination.prepareFile(input)).rejects.toThrow('disk unavailable');
  expect(closed).toBe(0);
  await destination.commitFile(input);
  expect(closed).toBe(1);
});

test('a truncated download is released so the next attempt opens a fresh stream', async () => {
  let downloads = 0;
  const adapter = createHttpWorkspaceAdapter({
    read: true,
    write: false,
    request: async () => ({ download: { url: 'https://peer/file', token: 'secret', size: 2 } }),
    createSink: async () => {
      throw new Error('unused');
    },
    fetchImpl: (async () =>
      new Response(
        ++downloads === 1 ? new Uint8Array([1]) : new Uint8Array([1, 2]),
      )) as typeof fetch,
  });
  await expect(adapter.source!.readChunk('a', 0, 2)).rejects.toThrow('declared size');
  expect(await adapter.source!.readChunk('a', 0, 2)).toEqual({ bytes: 2, dataBase64: 'AQI=' });
  expect(downloads).toBe(2);
});

test('upload retries resume bytes and a lost commit response does not upload again', async () => {
  let prepares = 0;
  let finishes = 0;
  let commits = 0;
  let closes = 0;
  const adapter = createHttpWorkspaceAdapter({
    read: false,
    write: true,
    request: async (operation) => {
      if (operation === 'files.transfer.prepare') {
        prepares++;
        return {
          offset: prepares === 1 ? 0 : 2,
          upload: { url: 'https://peer/file', token: 'secret', size: 4 },
        };
      }
      if (++commits === 1) throw new Error('commit response lost');
      return {};
    },
    createSink: async () => ({
      write: async () => {},
      finish: async (_ticket, offset, _signal, skipBytes) => {
        if (++finishes === 1) throw new Error('upload disconnected');
        expect(offset).toBe(2);
        expect(skipBytes).toBe(2);
        return 4;
      },
      close: async () => {
        closes++;
      },
    }),
  });
  const destination = adapter.destination!;
  const input = { transferId: 'resume', path: 'file', size: 4 };
  await destination.prepareFile(input);
  await destination.writeChunk({ transferId: 'resume', offset: 0, dataBase64: 'AQIDBA==' });
  await expect(destination.commitFile(input)).rejects.toThrow('upload disconnected');
  await expect(
    destination.writeChunk({ transferId: 'resume', offset: 4, dataBase64: '' }),
  ).rejects.toThrow('no longer accepting writes');
  await expect(destination.commitFile(input)).rejects.toThrow('commit response lost');
  await destination.commitFile(input);
  expect(prepares).toBe(2);
  expect(finishes).toBe(2);
  expect(commits).toBe(2);
  expect(closes).toBe(1);
});

test('local read buffers share one binary HTTP download', async () => {
  const calls: string[] = [];
  let downloads = 0;
  const adapter = createHttpWorkspaceAdapter({
    read: true,
    write: false,
    request: async (operation) => {
      calls.push(operation);
      return { download: { url: 'https://peer/file', token: 'secret', size: 6 } };
    },
    createSink: async () => {
      throw new Error('unused');
    },
    fetchImpl: (async (_url, init) => {
      downloads++;
      expect((init?.headers as any).authorization).toBe('Bearer secret');
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
    }) as typeof fetch,
  });
  expect(await adapter.source!.readChunk('a', 0, 4)).toEqual({ bytes: 4, dataBase64: 'AQIDBA==' });
  expect(await adapter.source!.readChunk('a', 4, 4)).toEqual({ bytes: 2, dataBase64: 'BQY=' });
  expect(downloads).toBe(1);
  expect(calls).toEqual(['files.transfer.read']);
});

test('local writes are staged then sent in one HTTP upload before commit', async () => {
  const calls: string[] = [];
  const writes: number[] = [];
  let uploads = 0;
  let closed = false;
  const adapter = createHttpWorkspaceAdapter({
    read: false,
    write: true,
    request: async (operation) => {
      calls.push(operation);
      return { offset: 2, upload: { url: 'https://peer/file', token: 'secret', size: 6 } };
    },
    createSink: async () => ({
      write: async (bytes) => {
        writes.push(...bytes);
      },
      finish: async (_ticket, offset) => {
        uploads++;
        expect(offset).toBe(2);
        return 6;
      },
      close: async () => {
        closed = true;
      },
    }),
  });
  const destination = adapter.destination!;
  await destination.prepareFile({ transferId: 'a', path: 'f', size: 6 });
  await destination.writeChunk({ transferId: 'a', offset: 2, dataBase64: 'AQI=' });
  await destination.writeChunk({ transferId: 'a', offset: 4, dataBase64: 'AwQ=' });
  await destination.commitFile({ transferId: 'a', path: 'f', size: 6 });
  expect(writes).toEqual([1, 2, 3, 4]);
  expect(uploads).toBe(1);
  expect(closed).toBe(true);
  expect(calls).toEqual(['files.transfer.prepare', 'files.transfer.commit']);
});
