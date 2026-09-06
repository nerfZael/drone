import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatWorkspaceOption } from '@drone/assistant-chat';
import { AssistantWorkspacePicker } from '../src/droneHub/assistant/AssistantWorkspacePicker';
import { AssistantWorkspacesPanel } from '../src/droneHub/assistant/AssistantSettingsPanels';
import {
  WORKSPACE_CATEGORIES,
  toggleWorkspace,
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

  test('first selection becomes the default and starts read-only', () => {
    const access = toggleWorkspace({ targets: [], defaultTargetId: null }, base);
    expect(access.defaultTargetId).toBe('drone:a');
    expect(access.targets[0]).toMatchObject({ read: true, write: false, execute: false });
    expect(toggleWorkspace(access, base)).toEqual({ targets: [], defaultTargetId: null });
  });

  test('renders search and refresh without an apply step', () => {
    const html = renderToStaticMarkup(
      <AssistantWorkspacePicker requestJson={requestJson} threadId="thread-1" />,
    );
    expect(html).toContain('aria-label="Search workspaces"');
    expect(html).toContain('aria-label="Refresh workspaces"');
    expect(html).not.toContain('Apply');
    expect(html).not.toContain('Show selected only');
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
    expect(html).toContain('aria-label="Search workspaces"');
    expect(html).toContain('Artifacts');
    expect(html).toContain('Private');
    expect(html).not.toContain('All workspaces and shared folders');
    expect(html).not.toContain('Connected-device workspaces');
  });
});
