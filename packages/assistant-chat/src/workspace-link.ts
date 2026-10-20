/**
 * Links to files in workspaces: `workspace://<workspace>/<path>#L<line>C<column>`.
 *
 * `<workspace>` is a workspace's name ("Guides") or its id ("host:workspace-…", "drone:…"); an id wins over a name,
 * so a link written with an id survives renames. `<path>` is relative to the workspace's root; a path that starts
 * with a second slash (`workspace://Mech//tmp/shot.png`) is absolute. Segments are percent-encoded where needed
 * (`workspace://Game%20Graphics/sprites/mech.png`). The same links work in chats, in Markdown and HTML previews, and
 * as the path of an agent's workspace file tools.
 */
export type WorkspaceLink = {
  /** The workspace's name or id, as written. */
  workspace: string;
  /** Relative to the workspace's root, or absolute when it starts with `/`; empty for the root itself. */
  path: string;
  line: number | null;
  column: number | null;
};

const PREFIX = /^workspace:\/\//i;

export function isWorkspaceLink(raw: unknown): boolean {
  return typeof raw === 'string' && PREFIX.test(raw.trim());
}

function positive(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Collapses `.` and repeated slashes; null when `..` would leave the root or the path has control characters. */
function normalizePath(raw: string): string | null {
  if (/[\0\r\n]/.test(raw)) return null;
  const absolute = raw.startsWith('/');
  const out: string[] = [];
  for (const segment of raw.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined;
}

export function parseWorkspaceLink(raw: unknown): WorkspaceLink | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!PREFIX.test(text)) return null;
  let rest = text.replace(PREFIX, '');
  let line: number | null = null;
  let column: number | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    const anchor = /^L(\d+)(?:C(\d+))?$/i.exec(rest.slice(hash + 1));
    if (anchor) {
      line = positive(anchor[1]);
      column = line == null ? null : positive(anchor[2]);
    }
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf('?');
  if (query >= 0) rest = rest.slice(0, query);
  const slash = rest.indexOf('/');
  const workspace = decode(slash >= 0 ? rest.slice(0, slash) : rest)?.trim();
  if (!workspace || /[\0\r\n/]/.test(workspace)) return null;
  const decoded = decode(slash >= 0 ? rest.slice(slash + 1) : '');
  if (decoded == null) return null;
  const path = normalizePath(decoded);
  if (path == null) return null;
  return { workspace, path: path === '/' ? '/' : path, line, column };
}

/** Percent-encodes what a URL path segment cannot hold, keeping `:` and `@` readable for ids like `host:workspace-…`. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':').replace(/%40/gi, '@');
}

export function formatWorkspaceLink(link: WorkspaceLink): string {
  const path = String(link.path ?? '');
  const absolute = path.startsWith('/');
  const segments = path.split('/').filter(Boolean).map(encodeSegment).join('/');
  const anchor = link.line ? `#L${link.line}${link.column ? `C${link.column}` : ''}` : '';
  return `workspace://${encodeSegment(link.workspace)}/${absolute ? '/' : ''}${segments}${anchor}`;
}

/**
 * The workspace a link names: its id, else its exact name, else a name that matches ignoring case when only one
 * does. Null when nothing (or more than one workspace) matches.
 */
export function resolveWorkspaceRef<T extends { id: string; name: string }>(ref: string, workspaces: readonly T[]): T | null {
  const wanted = String(ref ?? '').trim();
  if (!wanted) return null;
  const byId = workspaces.find((workspace) => workspace.id === wanted);
  if (byId) return byId;
  const exact = workspaces.filter((workspace) => workspace.name === wanted);
  if (exact.length) return exact[0];
  const loose = workspaces.filter((workspace) => workspace.name.toLowerCase() === wanted.toLowerCase());
  return loose.length === 1 ? loose[0] : null;
}

/** How a link should name this workspace: by name when no other workspace shares it, else by id. */
export function workspaceLinkRef<T extends { id: string; name: string }>(workspace: T, workspaces: readonly T[]): string {
  const name = workspace.name.trim();
  const shared = workspaces.some((other) => other.id !== workspace.id && other.name.trim().toLowerCase() === name.toLowerCase());
  return name && !shared && !name.includes('/') ? name : workspace.id;
}

/**
 * A file's path in a link to its workspace: relative to the root when inside it, else absolute. `root` and `path`
 * are absolute paths on the workspace's own filesystem.
 */
export function workspaceLinkPath(root: string, path: string): string {
  const base = `/${String(root ?? '').split('/').filter(Boolean).join('/')}`;
  const file = `/${String(path ?? '').split('/').filter(Boolean).join('/')}`;
  if (base === '/') return file.slice(1);
  if (file === base) return '';
  return file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
}

/** The absolute path a link's path names, given its workspace's root. */
export function workspaceLinkAbsolutePath(root: string, linkPath: string): string {
  if (linkPath.startsWith('/')) return linkPath;
  const base = `/${String(root ?? '').split('/').filter(Boolean).join('/')}`;
  return linkPath ? `${base === '/' ? '' : base}/${linkPath}` : base;
}
