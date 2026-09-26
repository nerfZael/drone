import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatWorkspaceOption } from '@drone/assistant-chat';
import { WorkspaceAccessPicker } from '../src/droneHub/assistant/WorkspaceAccessPicker';
import { AssistantWorkspacesPanel } from '../src/droneHub/assistant/AssistantSettingsPanels';
import {
  WORKSPACE_CATEGORIES,
  addWorkspace,
  removeWorkspace,
  setPermission,
  workspaceCategory,
} from '../src/droneHub/assistant/workspace-access-model';

const base: ChatWorkspaceOption = {
  id: 'drone:a',
  kind: 'drone',
  droneId: 'a',
  name: 'A',
  deviceId: 'device',
  deviceName: 'Desktop',
  read: true,
  write: true,
  execute: true,
};

const requestJson = async () => {
  throw new Error('not loaded in a static render');
};

describe('desktop workspace picker', () => {
  test('lists shared folders and repositories before drones', () => {
    expect(WORKSPACE_CATEGORIES).toEqual([
      'Repositories',
      'Folders',
      'Host drones',
      'Container drones',
    ]);
    expect(workspaceCategory({ ...base, kind: 'host', repository: true })).toBe('Repositories');
    expect(workspaceCategory({ ...base, kind: 'host', repository: false })).toBe('Folders');
    expect(workspaceCategory({ ...base, kind: 'host', runtime: 'host' })).toBe('Host drones');
    expect(workspaceCategory({ ...base, runtime: 'container' })).toBe('Container drones');
    expect(workspaceCategory({ ...base, kind: 'remote' })).toBe('Folders');
  });

  const all = { read: true, write: true, execute: true };
  const empty = { targets: [], defaultTargetId: null };

  test('adding gives Read and the first addition becomes the default', () => {
    const access = addWorkspace(empty, base);
    expect(access.defaultTargetId).toBe('drone:a');
    expect(access.targets[0]).toMatchObject({ read: true, write: false, execute: false });
    const two = addWorkspace(access, { ...base, id: 'drone:b', name: 'B' });
    expect(two.defaultTargetId).toBe('drone:a');
    expect(removeWorkspace(two, 'drone:a').defaultTargetId).toBe('drone:b');
    expect(removeWorkspace(access, 'drone:a')).toEqual(empty);
  });

  test('Write and Run include Read; Read off or the last permission off removes the workspace', () => {
    const run = setPermission(empty, base, 'execute', true, all);
    expect(run.targets[0]).toMatchObject({ read: true, write: false, execute: true });
    expect(setPermission(run, base, 'read', false, all)).toEqual(empty);
    const writeOnly = { read: false, write: true, execute: false };
    const dropBox = { ...base, ...writeOnly };
    const written = setPermission(empty, dropBox, 'write', true, writeOnly);
    expect(written.targets[0]).toMatchObject({ read: false, write: true, execute: false });
    expect(setPermission(written, dropBox, 'write', false, writeOnly)).toEqual(empty);
  });

  test('a permission the workspace does not offer is never granted, but can be taken away', () => {
    const readOnly = { read: true, write: false, execute: false };
    const access = setPermission(empty, base, 'read', true, readOnly);
    expect(setPermission(access, base, 'write', true, readOnly)).toBe(access);
    const granted = { targets: [{ ...base, write: true }], defaultTargetId: 'drone:a' };
    expect(setPermission(granted, base, 'write', false, readOnly).targets[0]).toMatchObject({ read: true, write: false });
  });

  test('renders the In use grid with a home row and an add field', () => {
    const html = renderToStaticMarkup(
      <WorkspaceAccessPicker requestJson={requestJson} endpoint="/api/entity/workspaces" home={{ name: 'Entity home', note: 'Always available' }} />,
    );
    expect(html).toContain('In use');
    expect(html).toContain('All workspaces');
    expect(html).toContain('Entity home');
    expect(html).toContain('aria-label="Add a workspace"');
    expect(html).not.toContain('Apply');
  });

  test('popover hosts the picker and keeps the private artifacts switch', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkspacesPanel
        requestJson={requestJson}
        threadId="thread-1"
        workspaces={[
          {
            id: 'artifacts',
            kind: 'artifacts',
            label: 'Artifacts',
            description: 'Private files for this chat',
            capabilities: [],
          } as any,
        ]}
        enabledWorkspaceIds={['artifacts']}
        disabled={false}
        onToggleWorkspace={() => undefined}
        onClose={() => undefined}
        placement="composer"
      />,
    );
    expect(html).toContain('Workspaces');
    expect(html).toContain('aria-label="Add a workspace"');
    expect(html).toContain('Artifacts');
    expect(html).toContain('Private');
    expect(html).not.toContain('All workspaces and shared folders');
    expect(html).not.toContain('Connected-device workspaces');
  });
});
