import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildNewDroneBranchPickerEntries,
  newDroneBranchPickerValue,
  parseNewDroneBranchPickerValue,
} from '../src/droneHub/app/new-drone-branch-picker';

describe('new drone branch picker', () => {
  test('pins the host branch before remote branches with compact metadata', () => {
    const entries = buildNewDroneBranchPickerEntries({
      hostBranch: 'main',
      remoteBranches: [
        {
          name: 'origin/feature/composer-picker',
          remote: 'origin',
          branch: 'feature/composer-picker',
          headSha: null,
        },
      ],
      remoteBranchCheckoutEnabled: true,
    });

    expect(entries[0]?.kind).not.toBe('separator');
    expect(entries[1]?.kind).toBe('separator');
    expect(entries[2]?.kind).not.toBe('separator');
    expect(
      renderToStaticMarkup(
        <>{entries[0]?.kind !== 'separator' ? entries[0]?.label : null}</>,
      ),
    ).toContain('Host');
    expect(
      renderToStaticMarkup(
        <>{entries[2]?.kind !== 'separator' ? entries[2]?.label : null}</>,
      ),
    ).toContain('Remote');
  });

  test('round-trips inline host and remote selections', () => {
    expect(parseNewDroneBranchPickerValue(newDroneBranchPickerValue('host', ''))).toEqual({
      branchSource: 'host',
    });
    expect(
      parseNewDroneBranchPickerValue(
        newDroneBranchPickerValue('remote', 'origin/feature/composer-picker'),
      ),
    ).toEqual({
      branchSource: 'remote',
      remoteBranch: 'origin/feature/composer-picker',
    });
  });

  test('disables remote choices for host execution', () => {
    const entries = buildNewDroneBranchPickerEntries({
      hostBranch: 'main',
      remoteBranches: [
        { name: 'origin/main', remote: 'origin', branch: 'main', headSha: null },
      ],
      remoteBranchCheckoutEnabled: false,
    });
    const remote = entries.find(
      (entry) => entry.kind !== 'separator' && entry.value !== 'host',
    );

    expect(remote?.kind).not.toBe('separator');
    if (remote?.kind !== 'separator') expect(remote?.disabled).toBe(true);
  });
});
