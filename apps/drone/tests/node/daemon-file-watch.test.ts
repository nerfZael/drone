// Runs under Node, as the daemon and the Hub do: runtimes differ in which
// watch events they deliver, most of all around a removed directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { DirectoryWatchSet, watchDirectoryEntries, watchFileChanges } from '../../src/daemon-file-events';

let dir = '';
let stop = () => {};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-file-watch-'));
});
afterEach(() => {
  stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

test('reports one change per save, including saves by rename, and ignores neighbouring files', async () => {
  const filePath = path.join(dir, 'notes.md');
  const temporary = path.join(dir, '.notes.md.tmp');
  fs.writeFileSync(filePath, 'one');
  let changes = 0;
  stop = watchFileChanges(filePath, () => { changes += 1; });

  fs.writeFileSync(path.join(dir, 'other.md'), 'unrelated');
  await settle();
  assert.equal(changes, 0);

  fs.writeFileSync(filePath, 'two');
  await settle();
  assert.equal(changes, 1);

  for (const [index, content] of ['three', 'four'].entries()) {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, filePath);
    await settle();
    assert.equal(changes, 2 + index);
  }

  fs.rmSync(filePath);
  await settle();
  assert.equal(changes, 4);
});

test('keeps hearing the file after its folder is removed and recreated, as a branch switch does', async () => {
  const folder = path.join(dir, 'docs');
  const filePath = path.join(folder, 'notes.md');
  fs.mkdirSync(folder);
  fs.writeFileSync(filePath, 'one');
  let changes = 0;
  stop = watchFileChanges(filePath, () => { changes += 1; });

  fs.rmSync(folder, { recursive: true });
  await until(() => changes >= 1, 'removal');
  fs.mkdirSync(folder);
  fs.writeFileSync(filePath, 'two');
  // The watch comes back on its own and reports that the file may have changed meanwhile.
  await until(() => changes >= 2, 'recreated folder');
  await settle();

  const before = changes;
  fs.writeFileSync(filePath, 'three');
  await until(() => changes > before, 'write after recreation');
});

test('a file whose folder does not exist yet is heard once it appears', async () => {
  const filePath = path.join(dir, 'later', 'notes.md');
  let changes = 0;
  stop = watchFileChanges(filePath, () => { changes += 1; });
  fs.mkdirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, 'one');
  await until(() => changes >= 1, 'late folder');
});

test('a folder reports entries added, removed and renamed, but not writes into existing files', async () => {
  const existing = path.join(dir, 'existing.ts');
  fs.writeFileSync(existing, 'one');
  let changes = 0;
  stop = watchDirectoryEntries(dir, () => { changes += 1; });

  // What a build or an agent editing in place does all day.
  for (let index = 0; index < 20; index += 1) fs.appendFileSync(existing, 'more');
  await settle();
  assert.equal(changes, 0);

  fs.writeFileSync(path.join(dir, 'new.ts'), 'new');
  await settle();
  assert.equal(changes, 1);

  fs.mkdirSync(path.join(dir, 'folder'));
  await settle();
  assert.equal(changes, 2);

  fs.renameSync(path.join(dir, 'new.ts'), path.join(dir, 'renamed.ts'));
  await settle();
  assert.equal(changes, 3);

  fs.rmSync(path.join(dir, 'renamed.ts'));
  await settle();
  assert.equal(changes, 4);
});

test('a burst of new files in one folder is reported as a few changes, not one per file', async () => {
  let changes = 0;
  stop = watchDirectoryEntries(dir, () => { changes += 1; });
  for (let index = 0; index < 200; index += 1) fs.writeFileSync(path.join(dir, `file-${index}.ts`), '');
  await settle();
  assert.ok(changes >= 1 && changes <= 5, `reported ${changes} changes`);
});

test('a watch set follows folders as they are added and dropped', async () => {
  const src = path.join(dir, 'src');
  const docs = path.join(dir, 'docs');
  fs.mkdirSync(src);
  fs.mkdirSync(docs);
  const changed: string[] = [];
  const watches = new DirectoryWatchSet((directory) => changed.push(directory));
  stop = () => watches.close();

  watches.set([src]);
  fs.writeFileSync(path.join(src, 'a.ts'), '');
  fs.writeFileSync(path.join(docs, 'a.md'), '');
  await settle();
  assert.deepEqual(changed, [src]);

  changed.length = 0;
  watches.set([docs]);
  fs.writeFileSync(path.join(src, 'b.ts'), '');
  fs.writeFileSync(path.join(docs, 'b.md'), '');
  await settle();
  assert.deepEqual(changed, [docs]);
});
