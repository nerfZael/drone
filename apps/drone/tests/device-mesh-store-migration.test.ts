import { describe, expect, test } from 'bun:test';
import { migrateDeviceMeshGrants } from '../src/hub/device-mesh/device-mesh-store';

describe('device mesh grant migrations', () => {
  test('maps only equivalent legacy native-chat actions onto drone control', () => {
    expect(
      migrateDeviceMeshGrants([
        {
          capability: 'drone-control',
          version: 1,
          operations: ['drones.list', 'chat.read'],
        },
        {
          capability: 'assistant-threads',
          version: 1,
          operations: ['thread.get', 'approval.resolve', 'thread.message.delete'],
        },
      ]),
    ).toEqual([
      {
        capability: 'drone-control',
        version: 1,
        operations: ['drones.list', 'chat.read', 'chat.approval.resolve', 'chat.message.delete'],
      },
      {
        capability: 'assistant-threads',
        version: 1,
        operations: ['thread.get', 'approval.resolve', 'thread.message.delete'],
      },
    ]);
  });

  test('does not broaden grants that lacked the corresponding legacy actions', () => {
    const grants = [
      { capability: 'drone-control', version: 1, operations: ['drones.list'] },
      { capability: 'assistant-threads', version: 1, operations: ['thread.get'] },
    ];
    expect(migrateDeviceMeshGrants(grants)).toEqual(grants);
  });

  test('adds explicit interruption recovery to devices already trusted to stop chats', () => {
    expect(
      migrateDeviceMeshGrants([
        {
          capability: 'drone-control',
          version: 1,
          operations: ['drones.list', 'chat.read', 'chat.prompt', 'chat.stop'],
        },
      ]),
    ).toEqual([
      {
        capability: 'drone-control',
        version: 1,
        operations: [
          'drones.list',
          'chat.read',
          'chat.prompt',
          'chat.stop',
          'chat.interruption.resolve',
        ],
      },
    ]);
  });

  test('keeps existing drone-management access compatible with narrower mutations', () => {
    expect(
      migrateDeviceMeshGrants([
        {
          capability: 'drone-control',
          version: 1,
          operations: ['drones.list', 'drone.delete'],
        },
      ]),
    ).toEqual([
      {
        capability: 'drone-control',
        version: 1,
        operations: [
          'drones.list',
          'drone.delete',
          'drone.rename',
          'chat.rename',
          'chat.delete',
          'sidebar.move',
          'groups.list',
          'group.create',
          'group.rename',
          'group.delete',
          'sidebar.organize',
        ],
      },
    ]);
  });

  test('does not silently broaden existing file preview access', () => {
    const grants = [
      {
        capability: 'drone-control',
        version: 1,
        operations: ['drones.list', 'file.preview'],
      },
    ];
    expect(migrateDeviceMeshGrants(grants)).toEqual(grants);
  });

  test('replaces legacy sidebar grants with the atomic move command', () => {
    expect(
      migrateDeviceMeshGrants([
        {
          capability: 'drone-control',
          version: 1,
          operations: ['drones.list', 'sidebar.order.update', 'sidebar.item.move'],
        },
      ]),
    ).toEqual([
      {
        capability: 'drone-control',
        version: 1,
        operations: ['drones.list', 'sidebar.move', 'sidebar.organize'],
      },
    ]);
  });

  test('preserves existing pin access through the atomic sidebar grant', () => {
    expect(
      migrateDeviceMeshGrants([
        {
          capability: 'drone-control',
          version: 1,
          operations: ['drones.list', 'drone.pin.update'],
        },
      ]),
    ).toEqual([
      {
        capability: 'drone-control',
        version: 1,
        operations: ['drones.list', 'sidebar.move', 'sidebar.organize'],
      },
    ]);
  });
});


test('organization inherits equivalent sidebar authority and is not granted to chat readers', () => {
  const organize = migrateDeviceMeshGrants([{ capability: 'drone-control', version: 1, operations: ['sidebar.move'] }]);
  expect(organize[0]!.operations).toEqual(['sidebar.move', 'sidebar.organize']);
  expect(migrateDeviceMeshGrants(organize)).toEqual(organize);
  expect(migrateDeviceMeshGrants([{ capability: 'drone-control', version: 1, operations: ['chat.read'] }])[0]!.operations).not.toContain('sidebar.organize');
});

test('devices that may create files on the Hub may also manage its workspaces; browsing follows listing files', async () => {
  const { isGranted } = await import('@drone/device-protocol');
  const migrated = migrateDeviceMeshGrants([{ capability: 'drone-control', version: 1, operations: ['files.list', 'file.action'] }]);
  expect(migrated[0].operations).toContain('workspaces.manage');
  expect(migrateDeviceMeshGrants([{ capability: 'drone-control', version: 1, operations: ['files.list'] }])[0].operations).not.toContain('workspaces.manage');
  const listing = [{ capability: 'drone-control', version: 1, operations: ['files.list'] }];
  expect(isGranted(listing, 'drone-control', 1, 'workspaces.browse')).toBe(true);
  expect(isGranted(listing, 'drone-control', 1, 'workspaces.manage')).toBe(false);
  expect(isGranted([{ capability: 'drone-control', version: 1, operations: ['chat.read'] }], 'drone-control', 1, 'workspaces.browse')).toBe(false);
});
