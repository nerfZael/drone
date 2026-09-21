// On Node, as the Hub and the daemon run: other runtimes report file events differently.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { MAX_REPO_WATCHED_DIRECTORIES, watchRepository, type RepoWatchRuntime } from '../../src/repo-watch';

let repo = '';
let stops: Array<() => void> = [];

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

beforeEach(() => {
  // Resolved, because git reports the repository by its real path.
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-watch-')));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const one = 1;\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(repo, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
  stops = [];
});

afterEach(() => {
  for (const stop of stops) stop();
  fs.rmSync(repo, { recursive: true, force: true });
});

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, 800));

async function follow(target = repo) {
  const seen = { changes: 0, live: [] as boolean[] };
  stops.push(
    watchRepository(target, {
      onChange: () => (seen.changes += 1),
      onLive: (live) => seen.live.push(live),
    }),
  );
  await until(() => seen.live.at(-1) === true, 'the watch to be in place');
  return seen;
}

/** Waits for the change, then for the burst to be over, so the next step starts from silence. */
async function changeAfter(seen: { changes: number }, act: () => void, label: string): Promise<void> {
  const before = seen.changes;
  act();
  await until(() => seen.changes > before, label);
  await quiet();
}

describe('repository watch', () => {
  test('an edit to a tracked file is reported, once per burst', async () => {
    const seen = await follow();
    for (let i = 0; i < 20; i += 1) fs.writeFileSync(path.join(repo, 'src', 'app.ts'), `export const one = ${i};\n`);
    await until(() => seen.changes > 0, 'the edit');
    await quiet();
    assert.equal(seen.changes, 1);
  });

  test('ignored directories are neither watched nor reported', async () => {
    const seen = await follow();
    fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 2;\n');
    fs.writeFileSync(path.join(repo, 'node_modules', 'pkg', 'other.js'), '');
    await quiet();
    assert.equal(seen.changes, 0);
  });

  test('a directory created later is followed too', async () => {
    const seen = await follow();
    await changeAfter(
      seen,
      () => {
        fs.mkdirSync(path.join(repo, 'src', 'feature', 'deep'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'src', 'feature', 'deep', 'new.ts'), 'export {};\n');
      },
      'the new directory',
    );
    await changeAfter(
      seen,
      () => fs.writeFileSync(path.join(repo, 'src', 'feature', 'deep', 'new.ts'), 'export const two = 2;\n'),
      'an edit inside the new directory',
    );
  });

  test('staging, committing and switching branches are reported', async () => {
    const seen = await follow();
    await changeAfter(seen, () => fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const one = 2;\n'), 'the edit');
    await changeAfter(seen, () => git('add', 'src/app.ts'), 'staging');
    await changeAfter(seen, () => git('commit', '--quiet', '-m', 'second'), 'the commit');
    await changeAfter(seen, () => git('checkout', '--quiet', '-b', 'other'), 'the branch switch');
  });

  test('a directory that a checkout removes and brings back is still followed', async () => {
    git('checkout', '--quiet', '-b', 'with-lib');
    fs.mkdirSync(path.join(repo, 'lib'));
    fs.writeFileSync(path.join(repo, 'lib', 'util.ts'), 'export {};\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'lib');
    const seen = await follow();
    await changeAfter(seen, () => git('checkout', '--quiet', 'main'), 'the checkout that removes lib');
    await changeAfter(seen, () => git('checkout', '--quiet', 'with-lib'), 'the checkout that restores lib');
    await changeAfter(
      seen,
      () => fs.writeFileSync(path.join(repo, 'lib', 'util.ts'), 'export const three = 3;\n'),
      'an edit inside the restored directory',
    );
  });

  test('reading git status the way the Hub does is not reported as a change', async () => {
    const seen = await follow();
    // Rewritten with the same content: the index entry is stale, and git status refreshes it when allowed to.
    await changeAfter(seen, () => fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const one = 1;\n'), 'the rewrite');
    const before = seen.changes;
    execFileSync('git', ['--no-optional-locks', '-C', repo, 'status', '--porcelain=v2', '--branch', '-z']);
    await quiet();
    assert.equal(seen.changes, before);
    // Which is why the Hub asks that way: a plain status rewrites the index, and that is a change.
    await changeAfter(seen, () => git('status', '--porcelain=v2'), 'the index refresh of a plain status');
  });

  test('a folder inside the repository follows the whole repository', async () => {
    const seen = await follow(path.join(repo, 'src'));
    await changeAfter(seen, () => fs.writeFileSync(path.join(repo, 'README.md'), '# Hi\n'), 'a change outside the folder');
  });

  test('listeners on one repository share its watches, which end with the last of them', async () => {
    let watchers = 0;
    const real = await import('node:fs');
    const runtime: RepoWatchRuntime = {
      git: async (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }),
      watch(directory, onEvent) {
        watchers += 1;
        const watcher = real.watch(directory, { persistent: false }, (type, name) => onEvent(type, name == null ? null : String(name)));
        return { close: () => { watchers -= 1; watcher.close(); } };
      },
      isDirectory: async (target) => real.existsSync(target) && real.statSync(target).isDirectory(),
    };
    const live: boolean[] = [];
    const first = watchRepository(repo, { onChange: () => undefined, onLive: (value) => live.push(value) }, runtime);
    await until(() => live.at(-1) === true, 'the first listener');
    const afterFirst = watchers;
    const lateLive: boolean[] = [];
    const second = watchRepository(repo, { onChange: () => undefined, onLive: (value) => lateLive.push(value) }, runtime);
    // A listener that joins a repository already being watched learns so at once.
    assert.deepEqual(lateLive, [true]);
    assert.equal(watchers, afterFirst);
    first();
    assert.equal(watchers, afterFirst);
    second();
    assert.equal(watchers, 0);
  });

  test('a repository too large to watch is reported as not live and holds no watches', async () => {
    let watchers = 0;
    const files = Array.from({ length: MAX_REPO_WATCHED_DIRECTORIES + 1 }, (_, i) => `d${i}/f.ts`).join('\0');
    const runtime: RepoWatchRuntime = {
      git: async (_root, args) => (args[0] === 'rev-parse' ? `${repo}\n${repo}/.git\n` : files),
      watch() {
        watchers += 1;
        return { close: () => (watchers -= 1) };
      },
      isDirectory: async () => false,
    };
    const live: boolean[] = [];
    stops.push(watchRepository(repo, { onChange: () => undefined, onLive: (value) => live.push(value) }, runtime));
    await until(() => live.length > 0, 'the verdict');
    assert.deepEqual(live, [false]);
    assert.equal(watchers, 0);
  });

  test('running out of watches gives back the ones already taken', async () => {
    let watchers = 0;
    const runtime: RepoWatchRuntime = {
      git: async (_root, args) => (args[0] === 'rev-parse' ? `${repo}\n${repo}/.git\n` : 'a/f.ts\0b/f.ts\0c/f.ts\0'),
      watch() {
        if (watchers >= 2) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        watchers += 1;
        return { close: () => (watchers -= 1) };
      },
      isDirectory: async () => false,
    };
    const live: boolean[] = [];
    stops.push(watchRepository(repo, { onChange: () => undefined, onLive: (value) => live.push(value) }, runtime));
    await until(() => live.length > 0, 'the verdict');
    assert.deepEqual(live, [false]);
    assert.equal(watchers, 0);
  });
});
