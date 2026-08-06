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
          'sidebar.order.update',
          'sidebar.item.move',
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
});
