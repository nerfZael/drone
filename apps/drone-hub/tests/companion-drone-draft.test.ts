import { describe, expect, test } from 'bun:test';

import {
  createCompanionDroneDraft,
  normalizeCompanionDroneDraftInput,
  resolveCompanionDraftCreationPreferences,
} from '../src/droneHub/companion/companion-drone-draft';

const defaultPreferences = {
  mode: 'with-chat' as const,
  runtime: 'container' as const,
  persistVolume: false,
  spawnAgentKey: 'builtin:cursor',
  spawnModel: '',
  spawnReasoning: '',
  spawnAgentPermissionMode: 'execute' as const,
  spawnApprovalPolicy: 'ask' as const,
  repoBranchSource: 'host' as const,
  repoCreateRemoteBranch: '',
};

const codexSpawnContext = {
  spawnAgentKey: 'builtin:codex',
  spawnModel: 'gpt-5',
  spawnReasoning: 'high',
  spawnAgentPermissionMode: 'write' as const,
  spawnApprovalPolicy: 'auto' as const,
  repoBranchSource: 'host' as const,
  repoCreateRemoteBranch: '',
};

describe('Companion drone drafts', () => {
  test('persists every requested draft independently', async () => {
    const createdNames: string[] = [];
    const create = async (input: ReturnType<typeof normalizeCompanionDroneDraftInput>) => {
      createdNames.push(input.name);
      return { droneId: `draft-${createdNames.length}`, droneName: input.name };
    };

    const first = await createCompanionDroneDraft(
      { name: 'Security Review', prompt: 'Review security.', repoPath: '/repo', group: 'Code Review' },
      create,
    );
    const second = await createCompanionDroneDraft(
      { name: 'Cleanliness Review', prompt: 'Review cleanliness.', repoPath: '/repo', group: 'Code Review' },
      create,
    );

    expect(createdNames).toEqual(['Security Review', 'Cleanliness Review']);
    expect(first).toMatchObject({ persisted: true, draft: true, droneId: 'draft-1' });
    expect(second).toMatchObject({ persisted: true, draft: true, droneId: 'draft-2' });
  });

  test('rejects invalid input before creating a draft', async () => {
    let called = false;
    await expect(
      createCompanionDroneDraft({ name: 'bad\nname', prompt: 'Review.' }, async () => {
        called = true;
        return { droneId: 'unexpected', droneName: 'unexpected' };
      }),
    ).rejects.toThrow('INVALID_DRAFT_NAME');
    expect(called).toBe(false);
  });

  test('requires a non-empty queued prompt', async () => {
    await expect(
      createCompanionDroneDraft({ name: 'Empty', prompt: '   ' }, async () => ({
        droneId: 'unexpected',
        droneName: 'unexpected',
      })),
    ).rejects.toThrow('INVALID_DRAFT_PROMPT');
  });

  test('normalizes the persisted identity returned by the creator', async () => {
    const result = await createCompanionDroneDraft(
      { prompt: '  Review this.  ' },
      async () => ({ droneId: ' draft-1 ', droneName: ' Review Draft ' }),
    );

    expect(result).toMatchObject({
      droneId: 'draft-1',
      name: 'Review Draft',
      prompt: 'Review this.',
    });
  });

  test('preserves remembered repo settings until a synchronized spawn context exists', () => {
    const remembered = {
      ...defaultPreferences,
      spawnAgentKey: 'builtin:blip',
      spawnModel: 'remembered-model',
    };

    expect(
      resolveCompanionDraftCreationPreferences({
        remembered,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: false,
      }),
    ).toEqual(remembered);

    expect(
      resolveCompanionDraftCreationPreferences({
        remembered,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: true,
      }),
    ).toMatchObject(codexSpawnContext);
  });

  test('uses the global spawn fallback when no repo settings were remembered', () => {
    expect(
      resolveCompanionDraftCreationPreferences({
        remembered: null,
        defaults: defaultPreferences,
        spawnContext: codexSpawnContext,
        hasSpawnContext: false,
      }),
    ).toMatchObject(codexSpawnContext);
  });
});
