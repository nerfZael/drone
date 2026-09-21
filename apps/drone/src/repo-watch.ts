import { spawn } from 'node:child_process';
import { promises as fsp, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

const CHANGE_SETTLE_MS = 300;
// A long build or rebase keeps changing files; whoever listens still hears about it this often.
const CHANGE_MAX_WAIT_MS = 2_000;
const RESCAN_SETTLE_MS = 500;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Past this the repository is left to whoever polls it, rather than use up the kernel's watches. */
export const MAX_REPO_WATCHED_DIRECTORIES = 8_192;

export type RepoWatchListener = {
  /** Git status may have changed. Carries no state; the listener reads the repository itself. */
  onChange: () => void;
  /** False while changes can go unseen, so the listener has to keep checking on its own. */
  onLive: (live: boolean) => void;
};

export type RepoWatchRuntime = {
  git: (repoRoot: string, args: string[]) => Promise<string>;
  watch: (directory: string, onEvent: (eventType: string, name: string | null) => void, onError: (error: any) => void) => { close: () => void };
  isDirectory: (target: string) => Promise<boolean>;
};

function runGit(repoRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Without optional locks git never rewrites the index here, which the watch would see as a change.
    const child = spawn('git', ['--no-optional-locks', '-C', repoRoot, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > GIT_MAX_OUTPUT_BYTES) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= GIT_MAX_OUTPUT_BYTES) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`git ${args[0]} failed`));
    });
  });
}

const nodeRuntime: RepoWatchRuntime = {
  git: runGit,
  watch(directory, onEvent, onError) {
    const watcher: FSWatcher = watch(directory, { persistent: false }, (eventType, name) =>
      onEvent(eventType, name == null ? null : String(name)),
    );
    watcher.on('error', onError);
    return watcher;
  },
  async isDirectory(target) {
    try {
      return (await fsp.stat(target)).isDirectory();
    } catch {
      return false;
    }
  },
};

/**
 * Watches everything `git status` depends on: the directories holding files
 * git does not ignore, and the git directory itself for commits, staging and
 * checkouts. Git says which directories those are, so `node_modules` and
 * build output cost no watches and cause no events.
 *
 * Directories are watched one by one rather than recursively: a recursive
 * watch cannot leave ignored directories out, and this runs inside containers
 * from a single bundled file, where a native watcher cannot be shipped.
 */
class RepoWatch {
  private readonly listeners = new Set<RepoWatchListener>();
  private readonly watches = new Map<string, { close: () => void }>();
  private gitDirectories = new Set<string>();
  private live: boolean | null = null;
  private stopped = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private scanning = false;
  private scanAgain = false;
  private retryMs = RETRY_MIN_MS;

  constructor(
    private readonly repoRoot: string,
    private readonly runtime: RepoWatchRuntime,
  ) {
    this.rescanLater(0);
  }

  add(listener: RepoWatchListener): void {
    this.listeners.add(listener);
    if (this.live !== null) listener.onLive(this.live);
  }

  /** True when that was the last listener. */
  remove(listener: RepoWatchListener): boolean {
    this.listeners.delete(listener);
    return this.listeners.size === 0;
  }

  stop(): void {
    this.stopped = true;
    for (const timer of [this.settleTimer, this.maxWaitTimer, this.rescanTimer]) if (timer) clearTimeout(timer);
    this.closeWatches(() => true);
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    for (const listener of [...this.listeners]) listener.onLive(live);
  }

  private changed(): void {
    if (this.stopped) return;
    const report = () => {
      if (this.settleTimer) clearTimeout(this.settleTimer);
      if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
      this.settleTimer = null;
      this.maxWaitTimer = null;
      for (const listener of [...this.listeners]) listener.onChange();
    };
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(report, CHANGE_SETTLE_MS);
    this.settleTimer.unref?.();
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(report, CHANGE_MAX_WAIT_MS);
      this.maxWaitTimer.unref?.();
    }
  }

  private rescanLater(delayMs = RESCAN_SETTLE_MS): void {
    if (this.stopped) return;
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      void this.rescan();
    }, delayMs);
    this.rescanTimer.unref?.();
  }

  private closeWatches(matches: (directory: string) => boolean): void {
    for (const [directory, watcher] of this.watches) {
      if (!matches(directory)) continue;
      watcher.close();
      this.watches.delete(directory);
    }
  }

  private onEvent(directory: string, eventType: string, name: string | null): void {
    if (this.stopped) return;
    if (this.gitDirectories.has(directory)) {
      // Git takes `index.lock` and the like before every write; the write itself follows.
      if (name?.endsWith('.lock')) return;
      this.changed();
      return;
    }
    // The git directory has its own watch, and git status does not look inside nested repositories.
    if (name === '.git') return;
    this.changed();
    if (name === '.gitignore') this.rescanLater();
    if (eventType !== 'rename') return;
    if (name == null) {
      this.rescanLater();
      return;
    }
    const target = path.join(directory, name);
    if (this.watches.has(target)) {
      // Removed or replaced, as a checkout does; the old watch no longer sees anything.
      this.closeWatches((watched) => watched === target || watched.startsWith(`${target}${path.sep}`));
      this.rescanLater();
      return;
    }
    void this.runtime.isDirectory(target).then((isDirectory) => {
      if (isDirectory) this.rescanLater();
    });
  }

  private async wantedDirectories(): Promise<{ worktree: string[]; git: string[] }> {
    // The path given may be a folder inside the repository; git status covers all of it.
    const [topLevel, gitDirectory] = (
      await this.runtime.git(this.repoRoot, ['rev-parse', '--show-toplevel', '--absolute-git-dir'])
    )
      .split('\n')
      .map((line) => line.trim());
    if (!topLevel || !gitDirectory) throw new Error('not a git repository');
    const listed = await this.runtime.git(topLevel, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const worktree = new Set<string>([topLevel]);
    for (const file of listed.split('\0')) {
      if (!file) continue;
      let directory = path.dirname(file);
      while (directory !== '.' && directory !== path.sep) {
        const absolute = path.join(topLevel, directory);
        if (worktree.has(absolute)) break;
        worktree.add(absolute);
        directory = path.dirname(directory);
      }
    }
    // HEAD, index and the merge markers live in the git directory; every move of HEAD is appended to logs/HEAD.
    return { worktree: [...worktree], git: [gitDirectory, path.join(gitDirectory, 'logs')] };
  }

  private async rescan(): Promise<void> {
    if (this.stopped) return;
    if (this.scanning) {
      this.scanAgain = true;
      return;
    }
    this.scanning = true;
    try {
      const wanted = await this.wantedDirectories();
      if (this.stopped) return;
      if (wanted.worktree.length + wanted.git.length > MAX_REPO_WATCHED_DIRECTORIES) {
        throw new Error('too many directories to watch');
      }
      this.gitDirectories = new Set(wanted.git);
      const all = new Set([...wanted.worktree, ...wanted.git]);
      this.closeWatches((directory) => !all.has(directory));
      let added = 0;
      for (const directory of all) {
        if (this.watches.has(directory)) continue;
        try {
          this.watches.set(
            directory,
            this.runtime.watch(
              directory,
              (eventType, name) => this.onEvent(directory, eventType, name),
              () => {
                this.closeWatches((watched) => watched === directory);
                this.rescanLater();
              },
            ),
          );
          added += 1;
        } catch (error: any) {
          // A directory that went away between the listing and now is simply not there to watch.
          if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
          throw error;
        }
      }
      this.retryMs = RETRY_MIN_MS;
      const wasLive = this.live === true;
      this.setLive(true);
      // Files written into a directory before its watch was in place were not seen.
      if (added > 0 && wasLive) this.changed();
    } catch {
      if (this.stopped) return;
      // Out of watches, too large, or not a repository right now. Watches held
      // back would starve whatever else watches files here, such as a dev server.
      this.closeWatches(() => true);
      this.setLive(false);
      this.rescanLater(this.retryMs);
      this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    } finally {
      this.scanning = false;
      if (this.scanAgain && !this.stopped) {
        this.scanAgain = false;
        this.rescanLater();
      }
    }
  }
}

const repoWatchesByRuntime = new WeakMap<RepoWatchRuntime, Map<string, RepoWatch>>();

/**
 * Follows a repository's git status. Listeners on the same repository share
 * one set of watches, which goes away with the last of them. `onLive(true)`
 * arrives once the watches are in place, and `onLive(false)` whenever they
 * cannot be kept, so a listener that polls knows when it may slow down.
 */
export function watchRepository(
  repoRoot: string,
  listener: RepoWatchListener,
  runtime: RepoWatchRuntime = nodeRuntime,
): () => void {
  const root = path.resolve(repoRoot);
  let watches = repoWatchesByRuntime.get(runtime);
  if (!watches) repoWatchesByRuntime.set(runtime, (watches = new Map()));
  let repoWatch = watches.get(root);
  if (!repoWatch) watches.set(root, (repoWatch = new RepoWatch(root, runtime)));
  const owner = watches;
  const current = repoWatch;
  current.add(listener);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (!current.remove(listener)) return;
    current.stop();
    if (owner.get(root) === current) owner.delete(root);
  };
}
