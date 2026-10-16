import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMessage } from '../src/droneHub/chat/MarkdownMessage';
import { ownWorkspaceOf, workspaceRoot, workspaceShownBy } from '../src/droneHub/workspaces/workspace-links';
import type { BrowsableWorkspace } from '../src/droneHub/workspaces/workspaces-client';
import type { DroneSummary } from '../src/droneHub/types';

const render = (text: string, withFiles = true) =>
  renderToStaticMarkup(React.createElement(MarkdownMessage, { text, ...(withFiles ? { onOpenFileReference: () => {} } : {}) }));

describe('workspace links in Markdown', () => {
  test('a link keeps its workspace:// href and opens as a file', () => {
    const html = render('See [the loop](workspace://Guides/gauntlet-loop.md#L40).');
    expect(html).toContain('href="workspace://Guides/gauntlet-loop.md#L40"');
    expect(html).toContain('title="Open Guides/gauntlet-loop.md:40"');
    expect(html).not.toContain('target="_blank"');
    expect(render('[art](workspace://Game%20Graphics/sprites/mech.png)')).toContain('title="Open Game Graphics/sprites/mech.png"');
  });

  test('inline code that is a workspace link opens too', () => {
    expect(render('`workspace://Guides/notes.md`')).toContain('aria-label="Open file Guides/notes.md"');
  });

  test('other schemes are still made safe', () => {
    expect(render('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  test('where files do not open, a workspace link is not followed as a web link', () => {
    expect(render('[the loop](workspace://Guides/gauntlet-loop.md)', false)).not.toContain('workspace://');
    // The editor's preview opens links itself.
    const preview = renderToStaticMarkup(React.createElement(MarkdownMessage, { text: '[the loop](workspace://Guides/a.md)', onOpenLink: () => true }));
    expect(preview).toContain('href="workspace://Guides/a.md"');
  });
});

describe('the workspace a link names and where it starts', () => {
  const workspaces: BrowsableWorkspace[] = [
    { id: 'host:guides', browseId: 'host:guides', name: 'Guides', kind: 'folder', category: 'Workspaces', path: '/home/me/hub/workspaces/Guides' },
    { id: 'host:local', browseId: 'host:local', name: 'local', kind: 'folder', category: 'Host drones', path: '/home/me/dev/local' },
    { id: 'drone:mech', browseId: 'mech', name: 'Mech', kind: 'drone', category: 'Container drones', droneId: 'mech' },
  ];
  const mech = { id: 'mech', name: 'Mech', runtime: 'container', repoAttached: true, repoPath: '/repo' } as DroneSummary;
  const local = { id: 'local', name: 'local', runtime: 'host', cwd: '/home/me/dev/local' } as DroneSummary;

  test('a drone is its container, or the folder a host drone works in', () => {
    expect(ownWorkspaceOf(mech, workspaces)?.id).toBe('drone:mech');
    expect(ownWorkspaceOf(local, workspaces)?.id).toBe('host:local');
  });

  test('an explorer shows a folder workspace by its browse id, else its drone', () => {
    expect(workspaceShownBy({ id: 'host:guides', homePath: '/home/me/hub/workspaces/Guides' }, workspaces)?.id).toBe('host:guides');
    expect(workspaceShownBy({ id: 'mech', homePath: '/work/repo' }, workspaces)?.id).toBe('drone:mech');
    expect(workspaceShownBy({ id: 'local', homePath: '/home/me/dev/local/' }, workspaces)?.id).toBe('host:local');
    expect(workspaceShownBy({ id: 'gone', homePath: '/nowhere' }, workspaces)).toBeNull();
  });

  test('a folder starts at its path, a container drone at its home', () => {
    expect(workspaceRoot(workspaces[0], {})).toBe('/home/me/hub/workspaces/Guides');
    expect(workspaceRoot(workspaces[2], { mech })).toBe('/work/repo');
    expect(workspaceRoot(workspaces[2], {})).toBeNull();
  });
});
