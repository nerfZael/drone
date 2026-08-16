import type { DesktopNewDronePreferences } from '../app/new-drone-preferences';

export type CompanionDroneDraftInput = {
  name: string;
  prompt: string;
  repoPath: string;
  group: string;
};

export type CompanionDroneDraftCreated = {
  droneId: string;
  droneName: string;
};

export type CompanionDroneDraftCreator = (
  input: CompanionDroneDraftInput,
) => Promise<CompanionDroneDraftCreated | null>;

type DesktopSpawnPreferences = Omit<
  DesktopNewDronePreferences,
  'mode' | 'runtime' | 'persistVolume'
>;

export function resolveCompanionDraftCreationPreferences({
  remembered,
  defaults,
  spawnContext,
  hasSpawnContext,
}: {
  remembered: DesktopNewDronePreferences | null;
  defaults: DesktopNewDronePreferences;
  spawnContext: DesktopSpawnPreferences;
  hasSpawnContext: boolean;
}): DesktopNewDronePreferences {
  const base = remembered ?? defaults;
  // A legacy local preference is authoritative until a synchronized repo or
  // global fallback exists. With no legacy value, the normal fallback applies.
  return !remembered || hasSpawnContext ? { ...base, ...spawnContext } : base;
}

export function normalizeCompanionDroneDraftInput(
  args: Record<string, unknown>,
): CompanionDroneDraftInput {
  const name = String(args.name ?? '').trim();
  const promptRaw = String(args.prompt ?? '');
  const prompt = promptRaw.trim();
  const repoPath = String(args.repoPath ?? '').trim();
  const group = String(args.group ?? '').trim();
  if (name.length > 80 || /[\r\n]/.test(name)) throw new Error('INVALID_DRAFT_NAME');
  if (!prompt) throw new Error('INVALID_DRAFT_PROMPT');
  if (promptRaw.length > 100_000) throw new Error('DRAFT_PROMPT_TOO_LARGE');
  if (repoPath.length > 4_096) throw new Error('INVALID_DRAFT_REPOSITORY');
  if (group.length > 64) throw new Error('INVALID_DRAFT_GROUP');
  return { name, prompt, repoPath, group };
}

/** Persist one independent draft. Repeated calls are intentionally additive. */
export async function createCompanionDroneDraft(
  args: Record<string, unknown>,
  create: CompanionDroneDraftCreator,
) {
  const input = normalizeCompanionDroneDraftInput(args);
  const created = await create(input);
  const droneId = String(created?.droneId ?? '').trim();
  if (!droneId) throw new Error('DRONE_DRAFT_NOT_CREATED');
  const droneName = String(created?.droneName ?? '').trim();
  return {
    ok: true as const,
    persisted: true as const,
    draft: true as const,
    droneId,
    name: droneName || input.name || droneId,
    prompt: input.prompt,
    repoPath: input.repoPath || null,
    group: input.group || null,
  };
}
