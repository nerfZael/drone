import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  createSkill,
  deleteSkillRecord,
  listSkills,
  listSkillsFromRegistry,
  renderSkillMarkdown,
  syncSkillLibraryToHostTargets,
  updateSkillRecord,
  type SkillRecord,
} from '../src/hub/skills';

async function withTempHomes<T>(fn: (ctx: { tempRoot: string; homeDir: string; xdgDataHome: string }) => Promise<T>): Promise<T> {
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
      expect(fs.readFileSync(path.join(codexSkillRoot, 'SKILL.md'), 'utf8')).toContain('name: "Repo Review"');
      expect(fs.readFileSync(path.join(codexSkillRoot, 'agents', 'openai.yaml'), 'utf8')).toContain('tools:');
      expect(fs.readFileSync(path.join(codexSkillRoot, 'scripts', 'check.sh'), 'utf8')).toContain('echo check');

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
