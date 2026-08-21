import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  createSkill,
  createSkillFromEditablePackage,
  deleteSkillRecord,
  listSkills,
  listSkillsFromRegistry,
  renderSkillMarkdown,
  renderSkillProjectionPackages,
  syncSkillLibraryToHostTargets,
  updateSkillRecord,
  updateSkillFromEditablePackage,
  type SkillRecord,
} from '../src/hub/skills';

async function withTempHomes<T>(
  fn: (ctx: { tempRoot: string; homeDir: string; xdgDataHome: string }) => Promise<T>,
): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skills-library-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDataHome = path.join(tempRoot, 'xdg-data');
  const droneDataDir = path.join(xdgDataHome, 'drone');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDataHome, { recursive: true });
  fs.mkdirSync(droneDataDir, { recursive: true });

  const prevHome = process.env.HOME;
  const prevXdg = process.env.XDG_DATA_HOME;
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  process.env.HOME = homeDir;
  process.env.XDG_DATA_HOME = xdgDataHome;
  process.env.DRONE_DATA_DIR = droneDataDir;
  resetDroneRootDirForTests();

  try {
    return await fn({ tempRoot, homeDir, xdgDataHome });
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function sampleSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id: 'skill-1',
    slug: 'repo-review',
    name: 'Repo Review',
    description: 'Review repository changes before shipping.',
    markdownBody: 'Check the diff, then summarize risks.',
    files: [
      {
        path: 'scripts/check.sh',
        content: '#!/usr/bin/env bash\necho check\n',
        kind: 'script',
      },
      {
        path: 'references/checklist.md',
        content: '- tests\n- migrations\n',
        kind: 'reference',
      },
    ],
    overlays: {
      codex: {
        openaiYaml: 'tools:\n  - bash\n',
      },
      claude: {
        argumentHint: '<pr-number>',
        allowedTools: ['Bash', 'Read'],
        userInvocable: true,
      },
      cursor: {
        disableModelInvocation: true,
      },
    },
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('skills library registry CRUD', () => {
  test('creates, updates, lists, and deletes skills in the shared registry', async () => {
    await withTempHomes(async () => {
      const created = await createSkill({
        name: 'Repo Review',
        description: 'Review repository changes before shipping.',
        content: 'Check the diff, then summarize risks.',
        files: [{ path: 'scripts/check.sh', content: '#!/usr/bin/env bash\necho check\n' }],
        overlays: {
          claude: {
            allowedTools: ['Bash', 'Read'],
            userInvocable: true,
          },
        },
      });

      expect(created.slug).toBe('repo-review');
      expect(created.markdownBody).toContain('summarize risks');

      const listed = await listSkills();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.files[0]?.path).toBe('scripts/check.sh');

      const updated = await updateSkillRecord(created.id, {
        name: 'PR Review',
        slug: 'pr-review',
        description: 'Review PR changes before shipping.',
        compatibility: 'codex,claude,cursor,opencode,pi',
        markdownBody: 'Start with failing tests.',
      });

      expect(updated.slug).toBe('pr-review');
      expect(updated.compatibility).toBe('codex,claude,cursor,opencode,pi');
      expect(updated.markdownBody).toBe('Start with failing tests.');

      const deleted = await deleteSkillRecord(created.id);
      expect(deleted).toBe(true);
      expect(await listSkills()).toHaveLength(0);
    });
  });
});

describe('editable skill packages', () => {
  test('creates and updates a skill from an in-memory package', async () => {
    await withTempHomes(async () => {
      const created = await createSkillFromEditablePackage({
        slug: 'virtual-review',
        files: [
          {
            path: 'SKILL.md',
            content: [
              '---',
              'name: Virtual Review',
              'description: Edit skills as virtual folders.',
              'license: MIT',
              'metadata:',
              '  owner: platform',
              '  priority: 2',
              '---',
              '',
              '# Review',
              '',
              'Read the package before editing.',
              '',
            ].join('\n'),
          },
          { path: 'scripts/check.sh', content: '#!/usr/bin/env bash\necho check\n' },
          { path: 'tools/custom.sh', content: 'custom\n', kind: 'script' },
          { path: 'agents/openai.yaml', content: 'tools:\n  - bash\n' },
        ],
      });

      expect(created.slug).toBe('virtual-review');
      expect(created.markdownBody).toContain('Read the package');
      expect(created.metadata).toEqual({ owner: 'platform', priority: '2' });
      expect(created.files).toEqual([
        {
          path: 'scripts/check.sh',
          content: '#!/usr/bin/env bash\necho check\n',
          kind: 'script',
        },
        {
          path: 'tools/custom.sh',
          content: 'custom\n',
          kind: 'script',
        },
      ]);
      expect(created.overlays?.codex?.openaiYaml).toContain('tools:');

      const withAgentSettings = await updateSkillRecord(created.id, {
        overlays: {
          ...created.overlays,
          claude: { userInvocable: true, allowedTools: ['Read'] },
          cursor: { disableModelInvocation: true },
        },
      });
      const updated = await updateSkillFromEditablePackage(withAgentSettings.id, {
        slug: 'renamed-review',
        files: [
          {
            path: 'SKILL.md',
            content:
              '---\nname: Renamed Review\ndescription: Updated through files mode.\n---\n\nUpdated body.\n',
          },
          { path: 'references/guide.md', content: '# Guide\n' },
        ],
      });

      expect(updated.slug).toBe('renamed-review');
      expect(updated.files.map((file) => file.path)).toEqual(['references/guide.md']);
      expect(updated.overlays?.codex).toBeUndefined();
      expect(updated.overlays?.claude?.userInvocable).toBe(true);
      expect(updated.overlays?.cursor?.disableModelInvocation).toBe(true);

      const replacedOverlays = await updateSkillFromEditablePackage(updated.id, {
        files: [
          {
            path: 'SKILL.md',
            content:
              '---\nname: Renamed Review\ndescription: Updated through files mode.\n---\n\nUpdated body.\n',
          },
        ],
        overlays: {
          claude: { model: 'sonnet' },
        },
      });

      expect(replacedOverlays.overlays?.claude).toEqual({ model: 'sonnet' });
      expect(replacedOverlays.overlays?.cursor).toBeUndefined();

      const emptyCodexFile = await createSkillFromEditablePackage({
        files: [
          {
            path: 'SKILL.md',
            content: '---\nname: Empty Codex\ndescription: Keep an empty managed file.\n---\n',
          },
          { path: 'agents/openai.yaml', content: '' },
        ],
      });
      expect(emptyCodexFile.overlays?.codex?.openaiYaml).toBe('');
      expect(
        renderSkillProjectionPackages([emptyCodexFile], 'codex').find(
          (entry) => entry.slug === 'empty-codex',
        )?.files,
      ).toContainEqual({ path: 'agents/openai.yaml', content: '', executable: false });
    });
  });

  test('rejects unsafe paths and unsupported portable frontmatter without changing the skill', async () => {
    await withTempHomes(async () => {
      await expect(
        createSkillFromEditablePackage({
          files: [
            { path: 'SKILL.md', content: '---\nname: Unsafe\ndescription: Unsafe package.\n---\n' },
            { path: '../outside.txt', content: 'nope' },
          ],
        }),
      ).rejects.toThrow('invalid file path');

      await expect(
        createSkillFromEditablePackage({
          files: [
            { path: 'SKILL.md', content: '---\nname: Kind\ndescription: Bad kind.\n---\n' },
            { path: 'tools/run.sh', content: 'run', kind: 'executable' as any },
          ],
        }),
      ).rejects.toThrow('invalid file kind');

      await expect(
        createSkillFromEditablePackage({
          files: [
            { path: 'SKILL.md', content: '---\nname: Conflict\ndescription: Bad tree.\n---\n' },
            { path: 'references', content: 'file' },
            { path: 'references/guide.md', content: 'nested' },
          ],
        }),
      ).rejects.toThrow('invalid file tree');

      await expect(
        createSkillFromEditablePackage({
          files: [
            { path: 'SKILL.md', content: '---\nname: Trailing\ndescription: Bad path.\n---\n' },
            { path: 'references/', content: 'bad' },
          ],
        }),
      ).rejects.toThrow('invalid file path');

      await expect(
        createSkillFromEditablePackage({
          files: [
            {
              path: 'SKILL.md',
              content:
                '---\nname: Unsupported\ndescription: Unsupported field.\nunknown-field: true\n---\n',
            },
          ],
        }),
      ).rejects.toThrow('unsupported portable frontmatter field');
      expect(await listSkills()).toHaveLength(0);
    });
  });
});

describe('skills library normalization and rendering', () => {
  test('normalizes legacy content fields and renders human-readable frontmatter', () => {
    const [legacy] = listSkillsFromRegistry({
      skills: {
        legacy: {
          name: 'Legacy Review',
          description: 'Old registry record.',
          content: 'Use the older content field.',
        },
      },
    });

    expect(legacy?.slug).toBe('legacy-review');
    expect(legacy?.markdownBody).toBe('Use the older content field.');

    const markdown = renderSkillMarkdown(legacy!, 'codex');
    expect(markdown).toContain('name: "Legacy Review"');
    expect(markdown).toContain('description: "Old registry record."');
    expect(markdown).toContain('Use the older content field.');
  });
});

describe('skills library projection', () => {
  test('continues healthy targets after one projection fails and releases the lock', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skill-projection-failure-'));
    try {
      const invalidRoot = path.join(tempRoot, 'not-a-directory');
      const healthyRoot = path.join(tempRoot, 'healthy', 'skills');
      fs.writeFileSync(invalidRoot, 'file\n', 'utf8');

      await expect(
        syncSkillLibraryToHostTargets({
          targets: [
            { agent: 'codex', rootPath: invalidRoot },
            { agent: 'codex', rootPath: healthyRoot },
          ],
          skills: [sampleSkill()],
        }),
      ).rejects.toThrow(`host skill projection failed for codex target ${invalidRoot}`);
      expect(fs.existsSync(path.join(healthyRoot, 'repo-review', 'SKILL.md'))).toBe(true);

      const subsequentRoot = path.join(tempRoot, 'subsequent', 'skills');
      await syncSkillLibraryToHostTargets({
        targets: [{ agent: 'codex', rootPath: subsequentRoot }],
        skills: [sampleSkill()],
      });
      expect(fs.existsSync(path.join(subsequentRoot, 'repo-review', 'SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('serializes concurrent projections into the shared host skill root', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skill-projection-concurrent-'));
    try {
      const sharedRoot = path.join(tempRoot, '.agents', 'skills');
      await Promise.all(
        Array.from({ length: 12 }, () =>
          syncSkillLibraryToHostTargets({
            targets: [{ agent: 'codex', rootPath: sharedRoot }],
            skills: [sampleSkill()],
          }),
        ),
      );

      const manifest = JSON.parse(
        fs.readFileSync(path.join(sharedRoot, '.drone-managed-skills.json'), 'utf8'),
      );
      expect(manifest.managedSlugs).toEqual(['repo-review']);
      expect(fs.readFileSync(path.join(sharedRoot, 'repo-review', 'SKILL.md'), 'utf8')).toContain(
        'name: "Repo Review"',
      );
      expect(
        fs.readFileSync(path.join(sharedRoot, 'repo-review', 'scripts', 'check.sh'), 'utf8'),
      ).toContain('echo check');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('writes native skill packages and only cleans up managed skill directories', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skill-projection-'));
    try {
      const codexRoot = path.join(tempRoot, '.agents', 'skills');
      const claudeRoot = path.join(tempRoot, '.claude', 'skills');
      const cursorRoot = path.join(tempRoot, '.cursor', 'skills');
      const opencodeRoot = path.join(tempRoot, '.opencode', 'skills');
      const unmanagedRoot = path.join(codexRoot, 'unmanaged');
      fs.mkdirSync(unmanagedRoot, { recursive: true });
      fs.writeFileSync(path.join(unmanagedRoot, 'keep.txt'), 'keep\n', 'utf8');

      await syncSkillLibraryToHostTargets({
        targets: [
          { agent: 'codex', rootPath: codexRoot },
          { agent: 'claude', rootPath: claudeRoot },
          { agent: 'cursor', rootPath: cursorRoot },
          { agent: 'opencode', rootPath: opencodeRoot },
        ],
        skills: [sampleSkill()],
      });

      const codexSkillRoot = path.join(codexRoot, 'repo-review');
      expect(fs.existsSync(path.join(codexSkillRoot, 'SKILL.md'))).toBe(true);
      expect(fs.readFileSync(path.join(codexSkillRoot, 'SKILL.md'), 'utf8')).toContain(
        'name: "Repo Review"',
      );
      expect(fs.readFileSync(path.join(codexSkillRoot, 'agents', 'openai.yaml'), 'utf8')).toContain(
        'tools:',
      );
      expect(fs.readFileSync(path.join(codexSkillRoot, 'scripts', 'check.sh'), 'utf8')).toContain(
        'echo check',
      );

      const claudeSkill = fs.readFileSync(path.join(claudeRoot, 'repo-review', 'SKILL.md'), 'utf8');
      expect(claudeSkill).toContain('argument-hint: "<pr-number>"');
      expect(claudeSkill).toContain('allowed-tools:');
      expect(claudeSkill).toContain('user-invocable: true');

      const cursorSkill = fs.readFileSync(path.join(cursorRoot, 'repo-review', 'SKILL.md'), 'utf8');
      expect(cursorSkill).toContain('disable-model-invocation: true');

      await syncSkillLibraryToHostTargets({
        targets: [
          { agent: 'codex', rootPath: codexRoot },
          { agent: 'claude', rootPath: claudeRoot },
          { agent: 'cursor', rootPath: cursorRoot },
          { agent: 'opencode', rootPath: opencodeRoot },
        ],
        skills: [],
      });

      expect(fs.existsSync(path.join(codexRoot, 'repo-review'))).toBe(false);
      expect(fs.existsSync(path.join(claudeRoot, 'repo-review'))).toBe(false);
      expect(fs.existsSync(path.join(cursorRoot, 'repo-review'))).toBe(false);
      expect(fs.existsSync(path.join(unmanagedRoot, 'keep.txt'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('cleanup-only targets remove old managed skill directories without leaving a manifest behind', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skill-cleanup-only-'));
    try {
      const cleanupRoot = path.join(tempRoot, '.claude', 'skills');
      const managedRoot = path.join(cleanupRoot, 'repo-review');
      const unmanagedRoot = path.join(cleanupRoot, 'unmanaged');
      fs.mkdirSync(managedRoot, { recursive: true });
      fs.mkdirSync(unmanagedRoot, { recursive: true });
      fs.writeFileSync(path.join(managedRoot, 'SKILL.md'), 'old\n', 'utf8');
      fs.writeFileSync(path.join(unmanagedRoot, 'keep.txt'), 'keep\n', 'utf8');
      fs.writeFileSync(
        path.join(cleanupRoot, '.drone-managed-skills.json'),
        `${JSON.stringify({ managedSlugs: ['repo-review'] }, null, 2)}\n`,
        'utf8',
      );

      await syncSkillLibraryToHostTargets({
        targets: [{ agent: 'claude', rootPath: cleanupRoot, cleanupOnly: true }],
        skills: [sampleSkill()],
      });

      expect(fs.existsSync(managedRoot)).toBe(false);
      expect(fs.existsSync(path.join(cleanupRoot, '.drone-managed-skills.json'))).toBe(false);
      expect(fs.existsSync(path.join(unmanagedRoot, 'keep.txt'))).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
