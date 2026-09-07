import { expect, test } from 'bun:test';
import { prepareWorkspaceFileOpen, type InitialFileRead } from '../src/droneHub/files/prepare-workspace-file-open';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = { ok: true, kind: 'text', content: 'hello' } as Awaited<InitialFileRead>;

test('starts both requests and opens a successfully read file without waiting for its parent listing', async () => {
  const read = deferred<Awaited<InitialFileRead>>();
  const directory = deferred<boolean>();
  const calls: string[] = [];
  const prepared = prepareWorkspaceFileOpen(
    () => { calls.push('read'); return read.promise; },
    () => { calls.push('list'); return directory.promise; },
  );
  expect(calls).toEqual(['read', 'list']);
  read.resolve(payload);
  const result = await prepared;
  expect(result.directory).toBe(false);
  expect(result.initialRead).toBe(read.promise);
  expect(await result.initialRead).toBe(payload);
  directory.resolve(false);
});

test('hands the in-flight read to the editor when the listing finishes first', async () => {
  const read = deferred<Awaited<InitialFileRead>>();
  const result = await prepareWorkspaceFileOpen(() => read.promise, async () => false);
  expect(result.directory).toBe(false);
  expect(result.initialRead).toBe(read.promise);
  read.resolve(payload);
  expect(await result.initialRead).toBe(payload);
});

test('preserves directory navigation when reading the target as a file fails', async () => {
  const directory = deferred<boolean>();
  const resultPromise = prepareWorkspaceFileOpen(
    () => Promise.reject(new Error('is a directory')),
    () => directory.promise,
  );
  directory.resolve(true);
  expect((await resultPromise).directory).toBe(true);
});

test('preserves the read error for editor feedback when directory lookup also fails', async () => {
  const error = new Error('file unavailable');
  const result = await prepareWorkspaceFileOpen(
    () => Promise.reject(error),
    () => Promise.reject(new Error('listing unavailable')),
  );
  expect(result.directory).toBe(false);
  await expect(result.initialRead).rejects.toBe(error);
});
