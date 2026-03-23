import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import { listSkills } from '../src/hub/skills';
import {
  importSkillFromSource,
  listSkillSourceCandidates,
  listSkillSources,
  previewSkillFromSource,
  resetSkillSourceCacheForTests,
} from '../src/hub/skill-sources';

async function withTempHomes<T>(fn: () => Promise<T>): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-skill-source-import-'));
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
    return await fn();
  } finally {
    if (prevHome == null) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevXdg == null) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    resetSkillSourceCacheForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createMockFetch(map: Record<string, { status?: number; body: string; contentType?: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const entry = map[url];
    if (!entry) {
      return new Response(JSON.stringify({ message: `missing mock for ${url}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(entry.body, {
      status: entry.status ?? 200,
      headers: { 'content-type': entry.contentType ?? 'application/json' },
    });
  }) as typeof fetch;
}

const anthropicMarketplace = JSON.stringify({
  metadata: {},
  plugins: [
    {
      name: 'example-skills',
      source: './',
      skills: ['./skills/portable-review', './skills/blocked-review'],
    },
  ],
});

const anthropicTree = JSON.stringify({
  sha: 'commit-sha-1',
  tree: [
    { path: 'skills/portable-review/SKILL.md', mode: '100644', type: 'blob' },
    { path: 'skills/portable-review/scripts/check.sh', mode: '100644', type: 'blob' },
    { path: 'skills/portable-review/references/checklist.md', mode: '100644', type: 'blob' },
    { path: 'skills/portable-review/agents/openai.yaml', mode: '100644', type: 'blob' },
    { path: 'skills/blocked-review/SKILL.md', mode: '100644', type: 'blob' },
    { path: 'skills/blocked-review/.claude/commands/review.md', mode: '100644', type: 'blob' },
  ],
});

const portableSkillMarkdown = `---
name: portable-review
description: |
  Review repository changes before shipping.
license: MIT
package: "@example/review"
---

Start with failing tests, then summarize risk.
`;

const blockedSkillMarkdown = `---
name: blocked-review
description: Uses unsupported package files.
---

This one should not import.
`;

const portableSkillMarkdownCrlf = ['---', 'name: portable-review', 'description: Portable skill with CRLF frontmatter.', '---', '', 'Body.']
  .join('\r\n');

beforeEach(() => {
  resetSkillSourceCacheForTests();
});

describe('skill source registry', () => {
  test('lists the curated GitHub sources', () => {
    const sources = listSkillSources();
    expect(sources.map((source) => source.id)).toEqual(['anthropic-skills', 'microsoft-skills']);
  });
});

describe('skill source candidate discovery', () => {
  test('classifies importable and blocked skills from the curated repo', async () => {
    const mockFetch = createMockFetch({
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json': {
        body: anthropicMarketplace,
        contentType: 'application/json',
      },
      'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1': {
        body: anthropicTree,
        contentType: 'application/json',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md': {
        body: portableSkillMarkdown,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/blocked-review/SKILL.md': {
        body: blockedSkillMarkdown,
        contentType: 'text/plain',
      },
    });

    const candidates = await listSkillSourceCandidates('anthropic-skills', mockFetch);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.name).toBe('blocked-review');
    expect(candidates[0]?.importStatus).toBe('not_importable');
    expect(candidates[0]?.importReason).toContain('unsupported agent-specific package file');
    expect(candidates[1]?.name).toBe('portable-review');
    expect(candidates[1]?.importStatus).toBe('importable');
  });

  test('accepts CRLF frontmatter and a closing fence at EOF', async () => {
    const mockFetch = createMockFetch({
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json': {
        body: anthropicMarketplace,
        contentType: 'application/json',
      },
      'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1': {
        body: anthropicTree,
        contentType: 'application/json',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md': {
        body: portableSkillMarkdownCrlf,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/blocked-review/SKILL.md': {
        body: blockedSkillMarkdown,
        contentType: 'text/plain',
      },
    });

    const candidates = await listSkillSourceCandidates('anthropic-skills', mockFetch);
    expect(candidates.find((candidate) => candidate.path === 'skills/portable-review')?.importStatus).toBe('importable');
  });

  test('force refresh bypasses the cached GitHub source analysis', async () => {
    resetSkillSourceCacheForTests();
    let currentTree = anthropicTree;
    let currentPortableSkillMarkdown = portableSkillMarkdown;
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json') {
        return new Response(anthropicMarketplace, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1') {
        return new Response(currentTree, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md') {
        return new Response(currentPortableSkillMarkdown, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (url === 'https://raw.githubusercontent.com/anthropics/skills/commit-sha-2/skills/portable-review/SKILL.md') {
        return new Response(
          `---
name: portable-review
description: Refreshed description.
---

Updated body.
`,
          {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          },
        );
      }
      if (url === 'https://raw.githubusercontent.com/anthropics/skills/commit-sha-2/skills/blocked-review/SKILL.md') {
        return new Response(blockedSkillMarkdown, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (url === 'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/blocked-review/SKILL.md') {
        return new Response(blockedSkillMarkdown, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      throw new Error(`missing mock for ${url}`);
    }) as typeof fetch;

    const first = await listSkillSourceCandidates('anthropic-skills', mockFetch);
    expect(first.find((candidate) => candidate.path === 'skills/portable-review')?.description).toBe(
      'Review repository changes before shipping.',
    );

    currentTree = JSON.stringify({
      sha: 'commit-sha-2',
      tree: [
        { path: 'skills/portable-review/SKILL.md', mode: '100644', type: 'blob' },
        { path: 'skills/portable-review/scripts/check.sh', mode: '100644', type: 'blob' },
      ],
    });
    currentPortableSkillMarkdown = `---
name: portable-review
description: Refreshed description.
---

Updated body.
`;

    const cached = await listSkillSourceCandidates('anthropic-skills', mockFetch);
    expect(cached.find((candidate) => candidate.path === 'skills/portable-review')?.description).toBe(
      'Review repository changes before shipping.',
    );

    const refreshed = await listSkillSourceCandidates('anthropic-skills', mockFetch, { forceRefresh: true });
    expect(refreshed.find((candidate) => candidate.path === 'skills/portable-review')?.description).toBe(
      'Refreshed description.',
    );
  });

  test('skips stale marketplace entries that are missing SKILL.md in the repo tree', async () => {
    const mockFetch = createMockFetch({
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json': {
        body: JSON.stringify({
          metadata: {},
          plugins: [
            {
              name: 'example-skills',
              source: './',
              skills: ['./skills/missing-review', './skills/portable-review'],
            },
          ],
        }),
        contentType: 'application/json',
      },
      'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1': {
        body: JSON.stringify({
          sha: 'commit-sha-1',
          tree: [{ path: 'skills/portable-review/SKILL.md', mode: '100644', type: 'blob' }],
        }),
        contentType: 'application/json',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md': {
        body: portableSkillMarkdown,
        contentType: 'text/plain',
      },
    });

    const candidates = await listSkillSourceCandidates('anthropic-skills', mockFetch);
    expect(candidates.map((candidate) => candidate.path)).toEqual(['skills/portable-review']);
  });
});

describe('skill source import', () => {
  test('builds a full pre-import preview of the source package and normalized result', async () => {
    const mockFetch = createMockFetch({
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json': {
        body: anthropicMarketplace,
        contentType: 'application/json',
      },
      'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1': {
        body: anthropicTree,
        contentType: 'application/json',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md': {
        body: portableSkillMarkdown,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/blocked-review/SKILL.md': {
        body: blockedSkillMarkdown,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/scripts/check.sh': {
        body: '#!/usr/bin/env bash\necho review\n',
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/references/checklist.md': {
        body: '- tests\n- migrations\n',
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/agents/openai.yaml': {
        body: 'tools:\n  - bash\n',
        contentType: 'text/plain',
      },
    });

    const preview = await previewSkillFromSource(
      {
        sourceId: 'anthropic-skills',
        path: 'skills/portable-review',
      },
      mockFetch,
    );

    expect(preview.candidate.importStatus).toBe('importable');
    expect(preview.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'agents/openai.yaml',
      'references/checklist.md',
      'scripts/check.sh',
    ]);
    expect(preview.normalized.slug).toBe('portable-review');
    expect(preview.normalized.overlays?.codex?.openaiYaml).toContain('tools:');
  });

  test('imports a curated GitHub skill into the canonical portable library', async () => {
    const mockFetch = createMockFetch({
      'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json': {
        body: anthropicMarketplace,
        contentType: 'application/json',
      },
      'https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1': {
        body: anthropicTree,
        contentType: 'application/json',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/SKILL.md': {
        body: portableSkillMarkdown,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/blocked-review/SKILL.md': {
        body: blockedSkillMarkdown,
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/scripts/check.sh': {
        body: '#!/usr/bin/env bash\necho review\n',
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/references/checklist.md': {
        body: '- tests\n- migrations\n',
        contentType: 'text/plain',
      },
      'https://raw.githubusercontent.com/anthropics/skills/commit-sha-1/skills/portable-review/agents/openai.yaml': {
        body: 'tools:\n  - bash\n',
        contentType: 'text/plain',
      },
    });

    await withTempHomes(async () => {
      const imported = await importSkillFromSource(
        {
          sourceId: 'anthropic-skills',
          path: 'skills/portable-review',
        },
        mockFetch,
      );

      expect(imported.slug).toBe('portable-review');
      expect(imported.compatibility).toBe('codex,claude,cursor,opencode,pi');
      expect(imported.markdownBody).toContain('summarize risk');
      expect(imported.files.map((file) => file.path)).toEqual(['references/checklist.md', 'scripts/check.sh']);
      expect(imported.overlays?.codex?.openaiYaml).toContain('tools:');
      expect(imported.metadata?.['source.repo']).toBe('anthropics/skills');
      expect(imported.metadata?.['source.path']).toBe('skills/portable-review');
      expect(imported.metadata?.['source.frontmatter.package']).toBe('@example/review');

      const listed = await listSkills();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.name).toBe('portable-review');
    });
  });
});
