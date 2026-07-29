import { describe, expect, test } from 'bun:test';

import {
  parseDroneAgentsMdOverride,
  resolveDefaultAgentsConfig,
  resolveRepoAgentsConfig,
} from '../src/hub/agents-config';

describe('agents config resolution', () => {
  test('allows per-drone AGENTS.md overrides up to 2 MiB', () => {
    const twoMiB = `${'a'.repeat(2 * 1024 * 1024 - 1)}\n`;

    expect(parseDroneAgentsMdOverride(twoMiB)).toBe(twoMiB);
    expect(() => parseDroneAgentsMdOverride(42)).toThrow('agentsMd must be a string');
    expect(() => parseDroneAgentsMdOverride('a'.repeat(2 * 1024 * 1024))).toThrow(
      'agentsMd must be at most 2 MiB',
    );
  });

  test('treats blank default content as disabled', () => {
    const resolved = resolveDefaultAgentsConfig({
      settings: {
        agents: {
          content: '   \n',
          updatedAt: '2026-04-09T00:00:00.000Z',
        },
      },
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.content).toBe('   \n');
    expect(resolved.updatedAt).toBe('2026-04-09T00:00:00.000Z');
  });

  test('inherits the global default when repo override is absent', () => {
    const resolved = resolveRepoAgentsConfig(
      {
        settings: {
          agents: {
            content: '# Default instructions',
          },
        },
        repos: {
          '/tmp/repo-a': {
            path: '/tmp/repo-a',
            addedAt: '2026-04-09T00:00:00.000Z',
          },
        },
      },
      '/tmp/repo-a',
    );

    expect(resolved.mode).toBe('inherit');
    expect(resolved.effectiveSource).toBe('default');
    expect(resolved.effectiveContent).toBe('# Default instructions\n');
  });

  test('uses repo override content when mode is override', () => {
    const resolved = resolveRepoAgentsConfig(
      {
        settings: {
          agents: {
            content: '# Default instructions',
          },
        },
        repos: {
          '/tmp/repo-a': {
            path: '/tmp/repo-a',
            addedAt: '2026-04-09T00:00:00.000Z',
            agents: {
              mode: 'override',
              content: '# Repo instructions',
            },
          },
        },
      },
      '/tmp/repo-a',
    );

    expect(resolved.mode).toBe('override');
    expect(resolved.effectiveSource).toBe('repo');
    expect(resolved.effectiveContent).toBe('# Repo instructions\n');
  });

  test('can disable injection for a repo even when a default exists', () => {
    const resolved = resolveRepoAgentsConfig(
      {
        settings: {
          agents: {
            content: '# Default instructions',
          },
        },
        repos: {
          '/tmp/repo-a': {
            path: '/tmp/repo-a',
            addedAt: '2026-04-09T00:00:00.000Z',
            agents: {
              mode: 'disabled',
              content: '# Ignored',
            },
          },
        },
      },
      '/tmp/repo-a',
    );

    expect(resolved.mode).toBe('disabled');
    expect(resolved.effectiveSource).toBe(null);
    expect(resolved.effectiveContent).toBeNull();
  });
});
