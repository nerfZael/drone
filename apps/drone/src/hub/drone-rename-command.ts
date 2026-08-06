export type RenameDroneInput = {
  droneRef: string;
  newName: string;
  expectedName?: string;
  source?: string | null;
  attempt?: number | null;
  suggestedBase?: string | null;
};

export type RenameDroneResult = {
  ok: true;
  id: string;
  oldName: string;
  newName: string;
  renamed: boolean;
  reason?: 'same-name';
};

export type RenameDroneCommand = (input: RenameDroneInput) => Promise<RenameDroneResult>;

type ResolvedDroneRef = { id: string; kind: 'real' | 'pending' };

export type RenameDroneCommandDependencies = {
  displayNameMaxLength: number;
  findDroneIdByRef(registry: any, ref: string): ResolvedDroneRef | null;
  loadRegistry(): Promise<any>;
  log(
    level: 'info' | 'warn',
    message: string,
    details?: Record<string, unknown>,
  ): void;
  normalizeDisplayName(value: unknown): string;
  normalizeDroneIdentity(value: unknown): string;
  notifyRegistryWrite(): void;
  persistDisplayName(input: {
    droneId: string;
    state: 'real' | 'pending';
    name: string;
    expectedName?: string;
  }): Promise<unknown>;
};

function commandError(message: string, status: number, code?: string): Error {
  return Object.assign(new Error(message), {
    status,
    ...(code ? { code } : {}),
  });
}

function errorStatus(error: any): number {
  if (Number.isInteger(error?.status)) return Number(error.status);
  if (error?.code === 'DRONE_RENAME_PRECONDITION_FAILED') return 409;
  return 500;
}

export function createRenameDroneCommand(
  deps: RenameDroneCommandDependencies,
): RenameDroneCommand {
  return async (input) => {
    const droneRef = String(input.droneRef ?? '').trim();
    const registry = await deps.loadRegistry();
    const found = deps.findDroneIdByRef(registry, droneRef);
    if (!found) throw commandError(`unknown drone: ${droneRef}`, 404, 'DRONE_NOT_FOUND');

    const currentEntry =
      (found.kind === 'real'
        ? registry?.drones?.[found.id]
        : registry?.pending?.[found.id]) ?? null;
    const droneId =
      deps.normalizeDroneIdentity(currentEntry?.id) ||
      deps.normalizeDroneIdentity(found.id) ||
      found.id;
    const oldName = String(currentEntry?.name ?? droneRef).trim() || droneRef;
    const sourceRaw = String(input.source ?? '').trim();
    const source = sourceRaw ? sourceRaw.slice(0, 64) : null;
    const attemptRaw = Number(input.attempt);
    const attempt =
      Number.isFinite(attemptRaw) && attemptRaw > 0 ? Math.floor(attemptRaw) : null;
    const suggestedBaseRaw = String(input.suggestedBase ?? '').trim();
    const suggestedBase = suggestedBaseRaw
      ? suggestedBaseRaw.slice(0, deps.displayNameMaxLength)
      : null;
    let newName = '';
    let expectedName: string | undefined;
    try {
      newName = deps.normalizeDisplayName(input.newName);
      if (input.expectedName !== undefined) {
        expectedName = deps.normalizeDisplayName(input.expectedName);
      }
    } catch (error: any) {
      const message = String(error?.message ?? error);
      deps.log('warn', 'drone rename rejected: invalid target name', {
        droneId,
        droneRef,
        oldName,
        attemptedName: String(input.newName ?? ''),
        source,
        attempt,
        suggestedBase,
        error: message,
      });
      throw commandError(message, 400, 'DRONE_RENAME_INVALID_NAME');
    }
    const logDetails = { droneId, oldName, newName, source, attempt, suggestedBase };

    if (source || attempt != null || suggestedBase) {
      deps.log('info', 'drone rename requested', logDetails);
    }
    if (oldName === newName) {
      deps.log('info', 'drone rename no-op (same name)', logDetails);
      return { ok: true, id: droneId, oldName, newName, renamed: false, reason: 'same-name' };
    }

    const conflictingReal = Object.entries(registry?.drones ?? {}).find(
      ([key, entry]: [string, any]) =>
        (deps.normalizeDroneIdentity(entry?.id) || key) !== droneId &&
        String(entry?.name ?? '').trim() === newName,
    );
    const conflictingPending = Object.entries(registry?.pending ?? {}).find(
      ([key, entry]: [string, any]) =>
        (deps.normalizeDroneIdentity(entry?.id) || key) !== droneId &&
        String(entry?.name ?? '').trim() === newName,
    );
    if (conflictingReal || conflictingPending) {
      const message = `${conflictingPending ? 'pending ' : ''}drone already exists: ${newName}`;
      deps.log('warn', 'drone rename failed', { ...logDetails, status: 409, error: message });
      throw commandError(message, 409, 'DRONE_RENAME_NAME_CONFLICT');
    }

    try {
      await deps.persistDisplayName({
        droneId,
        state: found.kind,
        name: newName,
        ...(expectedName !== undefined ? { expectedName } : {}),
      });
    } catch (error: any) {
      const status = errorStatus(error);
      deps.log(status === 409 ? 'info' : 'warn', status === 409 ? 'drone rename skipped' : 'drone rename failed', {
        ...logDetails,
        status,
        error: String(error?.message ?? error),
      });
      if (Number.isInteger(error?.status)) throw error;
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status });
    }

    deps.notifyRegistryWrite();
    deps.log('info', 'drone renamed', logDetails);
    return { ok: true, id: droneId, oldName, newName, renamed: true };
  };
}
