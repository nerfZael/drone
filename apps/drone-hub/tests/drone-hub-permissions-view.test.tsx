import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DroneHubPermissionsView } from '../src/droneHub/app/DroneHubPermissionsView';

describe('DroneHub permissions view', () => {
  test('presents per-chat access controls as a full settings destination', () => {
    const html = renderToStaticMarkup(
      <DroneHubPermissionsView
        chatLabel="payments-refactor · default"
        available
        loading={false}
        saving={false}
        error={null}
        readMode="all"
        writeMode="selected"
        executeMode="selected"
        selectedDrones={[
          { id: 'payments-refactor', label: 'payments-refactor', removable: false },
          { id: 'api-tests', label: 'api-tests' },
        ]}
        dropActive={false}
        onModeChange={() => {}}
        onRemoveDrone={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain('DroneHub permissions');
    expect(html).toContain('Back to chat');
    expect(html).toContain('Read');
    expect(html).toContain('Write');
    expect(html).toContain('Execute');
    expect(html).toContain('All drones');
    expect(html).toContain('Selected drones');
    expect(html).toContain('hold and drag across options to paint');
    expect(html).toContain('data-permission-kind="read"');
    expect(html).toContain('data-permission-kind="execute"');
    expect(html).toContain('2 selected');
    expect(html).toContain('Changes are saved automatically for this chat.');
    expect(html).toContain('Creating drones and chats');
    expect(html).toContain('makes it a child of this chat');
    expect(html).toContain('automatically grants');
    expect(html).toContain('Cloning also requires Read access');
    expect(html).toContain('cannot create child drones');
  });

  test('explains when DroneHub access is unavailable', () => {
    const html = renderToStaticMarkup(
      <DroneHubPermissionsView
        chatLabel="terminal"
        available={false}
        loading={false}
        saving={false}
        error={null}
        unavailableMessage="Terminal chats do not receive a DroneHub MCP credential."
        readMode="all"
        writeMode="selected"
        executeMode="selected"
        selectedDrones={[]}
        dropActive={false}
        onModeChange={() => {}}
        onRemoveDrone={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain('Unavailable');
    expect(html).toContain('Terminal chats do not receive a DroneHub MCP credential.');
    expect(html).toContain('disabled=""');
  });

  test('keeps optimistic permission choices interactive while a save is in flight', () => {
    const html = renderToStaticMarkup(
      <DroneHubPermissionsView
        chatLabel="optimistic"
        available
        loading={false}
        saving
        error={null}
        readMode="selected"
        writeMode="selected"
        executeMode="selected"
        selectedDrones={[]}
        dropActive={false}
        onModeChange={() => {}}
        onRemoveDrone={() => {}}
        onBack={() => {}}
      />,
    );

    expect(html).toContain('Saving');
    expect(html).not.toContain('disabled=""');
  });
});
