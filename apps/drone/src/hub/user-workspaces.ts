import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { droneRootPath } from '../host/paths';
import { getHubSettingsRepository } from '../host/hub-settings-repository';
import { hubChangeEvents } from './hub-change-events';

/**
 * Workspaces the user adds on this device: folders agents can be given access to and the explorer can browse, like
 * Companion home. A created workspace is a folder inside the workspaces directory, kept by its folder name, so it
 * moves with the directory or goes missing when the directory changes without it. A linked one is a folder anywhere
 * on disk, kept by its absolute path. Removing either only forgets it; files are never deleted.
 */
export type StoredUserWorkspace = {
  id: string;
  name: string;
  createdAt: string;
} & ({ kind: 'created'; folder: string } | { kind: 'linked'; path: string });

export type UserWorkspace = StoredUserWorkspace & {
  /** Where the folder is now (a created workspace resolves inside the current directory). */
  root: string;
  /** The folder is gone, or the directory changed without it. Missing workspaces are not offered anywhere else. */
  missing: boolean;
};

type Stored = { directory: string | null; workspaces: StoredUserWorkspace[] };

const SETTING_KEY = 'workspaces.user';
const MAX_WORKSPACES = 200;

export type UserWorkspaceStorage = {
  read(): Promise<Stored>;
  write(value: Stored): Promise<void>;
};

const settingsStorage: UserWorkspaceStorage = {
  async read() {
    return parseStored((await getHubSettingsRepository()).get<Stored>(SETTING_KEY)?.value);
  },
  async write(value) {
    await (await getHubSettingsRepository()).put(SETTING_KEY, value);
  },
};

function parseStored(value: unknown): Stored {
  const raw = (value ?? {}) as Partial<Stored>;
  const directory = typeof raw.directory === 'string' && path.isAbsolute(raw.directory) ? raw.directory : null;
  const workspaces = (Array.isArray(raw.workspaces) ? raw.workspaces : []).filter(
    (item): item is StoredUserWorkspace =>
      Boolean(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      ((item.kind === 'created' && typeof (item as any).folder === 'string') ||
        (item.kind === 'linked' && typeof (item as any).path === 'string' && path.isAbsolute((item as any).path))),
  );
  return { directory, workspaces };
}

export function defaultUserWorkspacesDirectory(): string {
  return droneRootPath('workspaces');
}

/** The id pickers and grants use, stable across renames and directory moves. */
export function userWorkspaceTargetId(id: string): string {
  return `host:workspace-${id}`;
}

function cleanName(value: unknown): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw badRequest('Give the workspace a name.');
  if (name.length > 80) throw badRequest('Keep the name under 80 characters.');
  if (/[\0\r\n]/.test(name)) throw badRequest('That name has characters a workspace name cannot have.');
  return name;
}

/** A folder name for a created workspace: the name without path separators or a leading dot. */
export function folderNameFor(name: string): string {
  const folder = name.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').trim();
  if (!folder) throw badRequest('Use a name with at least one letter or number.');
  return folder;
}

function badRequest(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') throw error;
    // Another filesystem: copy, then remove the original only once the copy is complete.
    try {
      await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    } catch (copyError) {
      // A partial copy is not a workspace; the original is untouched.
      await fs.rm(to, { recursive: true, force: true }).catch(() => undefined);
      throw copyError;
    }
    await fs.rm(from, { recursive: true, force: true });
  }
}

export class UserWorkspaces {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: UserWorkspaceStorage = settingsStorage,
    private readonly defaultDirectory: () => string = defaultUserWorkspacesDirectory,
  ) {}

  private directoryOf(stored: Stored): string {
    return stored.directory ?? this.defaultDirectory();
  }

  private rootOf(stored: Stored, workspace: StoredUserWorkspace): string {
    return workspace.kind === 'created' ? path.join(this.directoryOf(stored), workspace.folder) : workspace.path;
  }

  private async resolve(stored: Stored): Promise<UserWorkspace[]> {
    return await Promise.all(
      stored.workspaces.map(async (workspace) => {
        const root = this.rootOf(stored, workspace);
        return { ...workspace, root, missing: !(await isDirectory(root)) };
      }),
    );
  }

  /** Serializes changes so two quick edits never overwrite each other. */
  private change<T>(operation: (stored: Stored) => Promise<{ stored?: Stored; result: T }>): Promise<T> {
    const run = this.writes
      .catch(() => {})
      .then(async () => {
        const current = await this.storage.read();
        const { stored, result } = await operation(current);
        if (stored) {
          await this.storage.write(stored);
          // Pickers and switchers in every open Hub window and tab refresh their lists.
          hubChangeEvents.emitUserWorkspacesChange();
        }
        return result;
      });
    this.writes = run;
    return run;
  }

  async state(): Promise<{ directory: string; defaultDirectory: string; customDirectory: boolean; workspaces: UserWorkspace[] }> {
    const stored = await this.storage.read();
    return {
      directory: this.directoryOf(stored),
      defaultDirectory: this.defaultDirectory(),
      customDirectory: stored.directory !== null,
      workspaces: await this.resolve(stored),
    };
  }

  /** Workspaces whose folder is there now: the ones offered to pickers, agents and the explorer. */
  async available(): Promise<UserWorkspace[]> {
    return (await this.resolve(await this.storage.read())).filter((workspace) => !workspace.missing);
  }

  create(nameRaw: unknown): Promise<UserWorkspace> {
    return this.change(async (stored) => {
      const name = cleanName(nameRaw);
      if (stored.workspaces.length >= MAX_WORKSPACES) throw badRequest(`You can have at most ${MAX_WORKSPACES} workspaces.`);
      const folder = folderNameFor(name);
      const directory = this.directoryOf(stored);
      const root = path.join(directory, folder);
      const taken = stored.workspaces.find((item) => item.kind === 'created' && item.folder === folder);
      // Even one missing from this folder: it comes back here if its folder is moved back.
      if (taken) throw badRequest(`The workspace “${taken.name}” already uses the folder name “${folder}”. Choose another name.`, 409);
      if (await exists(root)) throw badRequest(`${root} already exists. Use Add folder to make it a workspace.`, 409);
      await fs.mkdir(root, { recursive: true });
      const workspace: StoredUserWorkspace = {
        id: crypto.randomUUID().replace(/-/g, ''),
        name,
        kind: 'created',
        folder,
        createdAt: new Date().toISOString(),
      };
      return { stored: { ...stored, workspaces: [...stored.workspaces, workspace] }, result: { ...workspace, root, missing: false } };
    });
  }

  link(pathRaw: unknown, nameRaw?: unknown): Promise<UserWorkspace> {
    return this.change(async (stored) => {
      const text = String(pathRaw ?? '').trim();
      if (!text || !path.isAbsolute(text)) throw badRequest('Enter the full path of a folder, like /home/you/notes.');
      const root = path.resolve(text);
      if (!(await isDirectory(root))) throw badRequest(`${root} is not a folder on this device.`);
      if (stored.workspaces.length >= MAX_WORKSPACES) throw badRequest(`You can have at most ${MAX_WORKSPACES} workspaces.`);
      const same = stored.workspaces.find((item) => this.rootOf(stored, item) === root);
      if (same) throw badRequest(`${root} is already the workspace “${same.name}”.`, 409);
      const name = nameRaw === undefined || String(nameRaw).trim() === '' ? cleanName(path.basename(root) || root) : cleanName(nameRaw);
      const workspace: StoredUserWorkspace = {
        id: crypto.randomUUID().replace(/-/g, ''),
        name,
        kind: 'linked',
        path: root,
        createdAt: new Date().toISOString(),
      };
      return { stored: { ...stored, workspaces: [...stored.workspaces, workspace] }, result: { ...workspace, root, missing: false } };
    });
  }

  /** Renames the workspace as it is shown; the folder keeps its name so paths agents use stay valid. */
  rename(id: string, nameRaw: unknown): Promise<void> {
    return this.change(async (stored) => {
      const name = cleanName(nameRaw);
      if (!stored.workspaces.some((item) => item.id === id)) throw badRequest('That workspace no longer exists.', 404);
      return { stored: { ...stored, workspaces: stored.workspaces.map((item) => (item.id === id ? { ...item, name } : item)) }, result: undefined };
    });
  }

  remove(id: string): Promise<void> {
    return this.change(async (stored) => {
      if (!stored.workspaces.some((item) => item.id === id)) throw badRequest('That workspace no longer exists.', 404);
      return { stored: { ...stored, workspaces: stored.workspaces.filter((item) => item.id !== id) }, result: undefined };
    });
  }

  /**
   * Points created workspaces at another directory (null: the default). With `migrate`, each created workspace's
   * folder moves there; one that cannot move (its name is taken there, or the move fails) stays where it was and is
   * reported, and will show as missing. Without it, nothing moves.
   */
  setDirectory(directoryRaw: unknown, migrate: boolean): Promise<{ moved: string[]; failed: Array<{ name: string; error: string }> }> {
    return this.change(async (stored) => {
      const text = directoryRaw === null || directoryRaw === undefined ? '' : String(directoryRaw).trim();
      if (text && !path.isAbsolute(text)) throw badRequest('Enter the full path of a folder, like /home/you/workspaces.');
      const next = text ? path.resolve(text) : null;
      const from = this.directoryOf(stored);
      const to = next ?? this.defaultDirectory();
      const updated: Stored = { ...stored, directory: next && next !== this.defaultDirectory() ? next : null };
      const moved: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];
      if (path.resolve(from) === path.resolve(to)) return { stored: updated, result: { moved, failed } };
      const inside = path.relative(from, to);
      if (migrate && inside && !inside.startsWith('..') && !path.isAbsolute(inside))
        throw badRequest('The new folder cannot be inside the current one when moving workspaces.');
      await fs.mkdir(to, { recursive: true });
      if (migrate) {
        for (const workspace of stored.workspaces) {
          if (workspace.kind !== 'created') continue;
          const source = path.join(from, workspace.folder);
          const target = path.join(to, workspace.folder);
          if (!(await isDirectory(source))) continue;
          if (await exists(target)) {
            failed.push({ name: workspace.name, error: `${target} already exists` });
            continue;
          }
          try {
            await moveFolder(source, target);
            moved.push(workspace.name);
          } catch (error) {
            failed.push({ name: workspace.name, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      return { stored: updated, result: { moved, failed } };
    });
  }
}

let shared: UserWorkspaces | null = null;
export function userWorkspaces(): UserWorkspaces {
  shared ??= new UserWorkspaces();
  return shared;
}
