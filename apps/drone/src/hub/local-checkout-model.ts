export type LocalAutoUpdates = 'off' | 'commits' | 'all';
export type LocalSnapshotKind = 'commit' | 'working-tree';

export type LocalCheckoutSession = {
  droneId: string;
  droneName: string;
  repoRoot: string;
  returnRef: string;
  returnSha: string;
  returnDetached: boolean;
  snapshotSha: string;
  snapshotKind: LocalSnapshotKind;
  sourceHeadSha: string;
  sourceTreeSha: string;
  sourceDirtyFileCount: number;
  activatedAt: string;
  updatedAt: string;
};

export type LocalCheckoutState = {
  autoUpdates: LocalAutoUpdates;
  session: LocalCheckoutSession | null;
  updatedAt: string | null;
};

export type RunResult = { code: number; stdout: string; stderr: string };

export class LocalCheckoutError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'LocalCheckoutError';
    this.code = code;
    this.status = status;
  }
}

export function isLocalAutoUpdates(value: unknown): value is LocalAutoUpdates {
  return value === 'off' || value === 'commits' || value === 'all';
}

export function normalizedGitSha(value: unknown): string | null {
  const sha = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

function normalizedAutoUpdates(value: unknown): LocalAutoUpdates {
  return value === 'commits' || value === 'all' ? value : 'off';
}

function normalizedSession(value: unknown): LocalCheckoutSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const droneId = String(raw.droneId ?? '').trim();
  const repoRoot = String(raw.repoRoot ?? '').trim();
  const returnRef = String(raw.returnRef ?? '').trim();
  const returnSha = normalizedGitSha(raw.returnSha);
  const snapshotSha = normalizedGitSha(raw.snapshotSha);
  const sourceHeadSha = normalizedGitSha(raw.sourceHeadSha);
  const sourceTreeSha = normalizedGitSha(raw.sourceTreeSha);
  if (
    !droneId ||
    !repoRoot ||
    !returnRef ||
    !returnSha ||
    !snapshotSha ||
    !sourceHeadSha ||
    !sourceTreeSha
  ) {
    return null;
  }
  return {
    droneId,
    droneName: String(raw.droneName ?? '').trim() || droneId,
    repoRoot,
    returnRef,
    returnSha,
    returnDetached: raw.returnDetached === true,
    snapshotSha,
    snapshotKind: raw.snapshotKind === 'working-tree' ? 'working-tree' : 'commit',
    sourceHeadSha,
    sourceTreeSha,
    sourceDirtyFileCount: Math.max(0, Number(raw.sourceDirtyFileCount) || 0),
    activatedAt: String(raw.activatedAt ?? '').trim() || new Date(0).toISOString(),
    updatedAt: String(raw.updatedAt ?? '').trim() || new Date(0).toISOString(),
  };
}

export function localCheckoutStateFromRegistry(registry: any): LocalCheckoutState {
  const stored = registry?.settings?.localCheckout ?? {};
  const session = normalizedSession(stored.session);
  return {
    autoUpdates: session ? normalizedAutoUpdates(stored.autoUpdates) : 'off',
    session,
    updatedAt: String(stored.updatedAt ?? '').trim() || null,
  };
}
