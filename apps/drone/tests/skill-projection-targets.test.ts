import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  buildContainerMcpProjectionTargets,
  buildContainerSkillProjectionTargets,
  buildHostMcpProjectionTargets,
  buildHostSkillProjectionTargets,
} from '../src/hub/server';

describe('skill projection targets', () => {
  test('uses home-level targets for repo-backed host drones and cleans up old repo-level projections', () => {
    const repoRoot = path.join(os.tmpdir(), 'repo-root');
    const targets = buildHostSkillProjectionTargets({
      repoAttached: true,
      repoPath: repoRoot,
    });

    expect(targets.filter((target) => !target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: path.join(os.homedir(), '.agents', 'skills') },
      { agent: 'claude', rootPath: path.join(os.homedir(), '.claude', 'skills') },
      { agent: 'cursor', rootPath: path.join(os.homedir(), '.cursor', 'skills') },
      { agent: 'opencode', rootPath: path.join(os.homedir(), '.config', 'opencode', 'skills') },
    ]);
    expect(targets.filter((target) => target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: path.join(repoRoot, '.agents', 'skills'), cleanupOnly: true },
      { agent: 'claude', rootPath: path.join(repoRoot, '.claude', 'skills'), cleanupOnly: true },
      { agent: 'cursor', rootPath: path.join(repoRoot, '.cursor', 'skills'), cleanupOnly: true },
      { agent: 'opencode', rootPath: path.join(repoRoot, '.opencode', 'skills'), cleanupOnly: true },
    ]);
  });

  test('uses home-level targets for repo-backed container drones and cleans up old repo-level projections', () => {
    const targets = buildContainerSkillProjectionTargets({
      repoAttached: true,
      repo: { dest: '/work/repo' },
    });

    expect(targets.filter((target) => !target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: '/root/.agents/skills' },
      { agent: 'claude', rootPath: '/root/.claude/skills' },
      { agent: 'cursor', rootPath: '/root/.cursor/skills' },
      { agent: 'opencode', rootPath: '/root/.config/opencode/skills' },
    ]);
    expect(targets.filter((target) => target.cleanupOnly)).toEqual([
      { agent: 'codex', rootPath: '/work/repo/.agents/skills', cleanupOnly: true },
      { agent: 'claude', rootPath: '/work/repo/.claude/skills', cleanupOnly: true },
      { agent: 'cursor', rootPath: '/work/repo/.cursor/skills', cleanupOnly: true },
      { agent: 'opencode', rootPath: '/work/repo/.opencode/skills', cleanupOnly: true },
    ]);
  });
});

describe('MCP projection targets', () => {
  test('uses only global host config paths', () => {
    expect(buildHostMcpProjectionTargets({ repoAttached: true })).toEqual([
      { agent: 'codex', configPath: path.join(os.homedir(), '.codex', 'config.toml') },
      { agent: 'cursor', configPath: path.join(os.homedir(), '.cursor', 'mcp.json') },
      { agent: 'claude', configPath: path.join(os.homedir(), '.claude.json') },
      { agent: 'opencode', configPath: path.join(os.homedir(), '.config', 'opencode', 'opencode.json') },
    ]);
  });

  test('uses only global container config paths', () => {
    expect(buildContainerMcpProjectionTargets({ repoAttached: true, repo: { dest: '/work/repo' } })).toEqual([
      { agent: 'codex', configPath: '/root/.codex/config.toml' },
      { agent: 'cursor', configPath: '/root/.cursor/mcp.json' },
      { agent: 'claude', configPath: '/root/.claude.json' },
      { agent: 'opencode', configPath: '/root/.config/opencode/opencode.json' },
    ]);
  });
});
