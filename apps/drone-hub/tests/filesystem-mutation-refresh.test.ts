import { describe, expect, test } from 'bun:test';

import {
  filesystemMutationRefreshPlan,
  joinFsPath,
  pathMatchesRefreshScope,
} from '../src/droneHub/files/filesystem-mutation-refresh';

describe('filesystem mutation refresh planning', () => {
  test('refreshes only source/destination parents and their immediate parents', () => {
    const plan = filesystemMutationRefreshPlan({
      sourcePaths: ['/work/repo/src/old/name.ts'],
      destinationPaths: ['/work/repo/generated/name.ts'],
    });

    expect(plan.listingPaths).toEqual([
      '/work/repo/src/old',
      '/work/repo/generated',
      '/work/repo/src',
      '/work/repo',
    ]);
    expect(plan.listingPaths).not.toContain('/work');
  });

  test('invalidates renamed directory descendants without touching siblings', () => {
    const plan = filesystemMutationRefreshPlan({
      sourcePaths: ['/work/repo/src/old'],
      destinationPaths: ['/work/repo/src/new'],
    });

    expect(pathMatchesRefreshScope('/work/repo/src/old/nested', plan)).toBe(true);
    expect(pathMatchesRefreshScope('/work/repo/src/new/nested', plan)).toBe(true);
    expect(pathMatchesRefreshScope('/work/repo/src/sibling', plan)).toBe(false);
  });

  test('normalizes joined destination paths', () => {
    expect(joinFsPath('/work/repo/', '/asset.png')).toBe('/work/repo/asset.png');
    expect(joinFsPath('/', 'asset.png')).toBe('/asset.png');
  });
});
