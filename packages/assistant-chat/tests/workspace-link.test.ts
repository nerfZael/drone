import { describe, expect, test } from 'bun:test';
import {
  formatWorkspaceLink,
  isWorkspaceLink,
  parseWorkspaceLink,
  resolveWorkspaceRef,
  workspaceLinkAbsolutePath,
  workspaceLinkPath,
  workspaceLinkRef,
} from '../src/workspace-link';

describe('workspace links', () => {
  test('name a workspace, a path in it, and a line', () => {
    expect(parseWorkspaceLink('workspace://Guides/gauntlet-loop.md#L40C3')).toEqual({
      workspace: 'Guides', path: 'gauntlet-loop.md', line: 40, column: 3,
    });
    expect(parseWorkspaceLink('workspace://Game%20Graphics/sprites/mech%201.png')).toEqual({
      workspace: 'Game Graphics', path: 'sprites/mech 1.png', line: null, column: null,
    });
    expect(parseWorkspaceLink('workspace://host:workspace-04bb/docs/./a//b.md?x=1#intro')).toEqual({
      workspace: 'host:workspace-04bb', path: 'docs/a/b.md', line: null, column: null,
    });
    expect(parseWorkspaceLink('WORKSPACE://Guides')).toEqual({ workspace: 'Guides', path: '', line: null, column: null });
    expect(parseWorkspaceLink('workspace://Mech//tmp/shot.png')?.path).toBe('/tmp/shot.png');
  });

  test('refuse what is not a link to a place inside a workspace', () => {
    for (const raw of ['https://x', 'workspace:Guides/a', 'workspace:///a', 'workspace://Guides/../secret', 'workspace://%E0%A4%A/a', 'workspace://G/a%00b']) {
      expect(parseWorkspaceLink(raw)).toBeNull();
    }
    expect(isWorkspaceLink(' workspace://Guides/a ')).toBe(true);
    expect(isWorkspaceLink('/work/repo/a')).toBe(false);
  });

  test('format back to what they parse from, readable where they can be', () => {
    const links = [
      { workspace: 'Game Graphics', path: 'sprites/mech 1.png', line: 12, column: null },
      { workspace: 'host:workspace-04bb', path: '', line: null, column: null },
      { workspace: 'drone:abc', path: '/tmp/shot.png', line: 3, column: 9 },
    ];
    expect(links.map(formatWorkspaceLink)).toEqual([
      'workspace://Game%20Graphics/sprites/mech%201.png#L12',
      'workspace://host:workspace-04bb/',
      'workspace://drone:abc//tmp/shot.png#L3C9',
    ]);
    for (const link of links) expect(parseWorkspaceLink(formatWorkspaceLink(link))).toEqual(link);
  });

  test('find their workspace by id, then name, and name it by id only when the name is shared', () => {
    const all = [
      { id: 'host:a', name: 'Guides' },
      { id: 'drone:1', name: 'Mech' },
      { id: 'drone:2', name: 'mech' },
      { id: 'host:b', name: 'Notes' },
    ];
    expect(resolveWorkspaceRef('host:b', all)?.id).toBe('host:b');
    expect(resolveWorkspaceRef('Guides', all)?.id).toBe('host:a');
    expect(resolveWorkspaceRef('guides', all)?.id).toBe('host:a');
    expect(resolveWorkspaceRef('Mech', all)?.id).toBe('drone:1');
    expect(resolveWorkspaceRef('MECH', all)).toBeNull();
    expect(resolveWorkspaceRef('Nowhere', all)).toBeNull();
    expect(workspaceLinkRef(all[0], all)).toBe('Guides');
    expect(workspaceLinkRef(all[1], all)).toBe('drone:1');
  });

  test('paths are relative to the workspace root when inside it', () => {
    expect(workspaceLinkPath('/work/repo', '/work/repo/docs/a.md')).toBe('docs/a.md');
    expect(workspaceLinkPath('/work/repo/', '/work/repo')).toBe('');
    expect(workspaceLinkPath('/work/repo', '/work/repository/a')).toBe('/work/repository/a');
    expect(workspaceLinkPath('/', '/etc/hosts')).toBe('etc/hosts');
    expect(workspaceLinkAbsolutePath('/work/repo', 'docs/a.md')).toBe('/work/repo/docs/a.md');
    expect(workspaceLinkAbsolutePath('/work/repo', '/tmp/x')).toBe('/tmp/x');
    expect(workspaceLinkAbsolutePath('/home/me/Guides', '')).toBe('/home/me/Guides');
  });
});
