import { describe, expect, test } from 'bun:test';
import { deriveCreatedDroneEnvironmentConfig, resolveDroneEnvironmentConfig, resolveRepoEnvironmentConfig } from '../src/hub/environment-config';

describe('environment config helpers', () => {
  test('resolves repo and no-repo config', () => {
    const regAny = {
      settings: {
        nonRepoEnvironment: {
          vars: { SHARED: '1' },
          autoApplyToNewContainerDrones: true,
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      },
      repos: {
        '/tmp/repo-a': {
          path: '/tmp/repo-a',
          addedAt: '2026-03-20T00:00:00.000Z',
          environment: {
            vars: { API_KEY: 'secret', DEBUG: 'true' },
            autoApplyToNewContainerDrones: false,
            updatedAt: '2026-03-20T00:00:00.000Z',
          },
        },
      },
    };

    expect(resolveRepoEnvironmentConfig(regAny, '/tmp/repo-a')).toMatchObject({
      repoPath: '/tmp/repo-a',
      label: 'repo-a',
      registered: true,
      vars: { API_KEY: 'secret', DEBUG: 'true' },
      autoApplyToNewContainerDrones: false,
    });
    expect(resolveRepoEnvironmentConfig(regAny, '')).toMatchObject({
      repoPath: '',
      label: 'No Repository',
      vars: { SHARED: '1' },
      autoApplyToNewContainerDrones: true,
    });
  });

  test('merges repo vars, exclusions, and custom overrides for a drone', () => {
    const regAny = {
      repos: {
        '/tmp/repo-a': {
          path: '/tmp/repo-a',
          addedAt: '2026-03-20T00:00:00.000Z',
          environment: {
            vars: { API_KEY: 'secret', DEBUG: 'true', KEEP: 'repo' },
            autoApplyToNewContainerDrones: true,
          },
        },
      },
    };

    const resolved = resolveDroneEnvironmentConfig(regAny, {
      repoPath: '/tmp/repo-a',
      environment: {
        useRepoVars: true,
        disabledRepoKeys: ['DEBUG'],
        vars: { KEEP: 'custom', LOCAL_ONLY: '1' },
      },
    });

    expect(resolved.repoVars).toEqual({
      API_KEY: 'secret',
      KEEP: 'repo',
    });
    expect(resolved.resolvedVars).toEqual({
      API_KEY: 'secret',
      KEEP: 'custom',
      LOCAL_ONLY: '1',
    });
  });

  test('derives auto-apply state only for new container drones', () => {
    const regAny = {
      repos: {
        '/tmp/repo-a': {
          path: '/tmp/repo-a',
          addedAt: '2026-03-20T00:00:00.000Z',
          environment: {
            vars: { API_KEY: 'secret' },
            autoApplyToNewContainerDrones: true,
          },
        },
      },
    };

    expect(deriveCreatedDroneEnvironmentConfig(regAny, { repoPath: '/tmp/repo-a', runtime: 'container' })).toEqual({
      vars: {},
      useRepoVars: true,
      disabledRepoKeys: [],
      updatedAt: null,
    });
    expect(deriveCreatedDroneEnvironmentConfig(regAny, { repoPath: '/tmp/repo-a', runtime: 'host' })).toEqual({
      vars: {},
      useRepoVars: false,
      disabledRepoKeys: [],
      updatedAt: null,
    });
  });
});
