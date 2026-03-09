import { describe, expect, test } from 'bun:test';
import { resolveDefaultPreviewPort } from '../src/droneHub/app/helpers';
import type { DronePortMapping } from '../src/droneHub/types';

function port(containerPort: number, hostPort: number): DronePortMapping {
  return { containerPort, hostPort };
}

describe('resolveDefaultPreviewPort', () => {
  test('prefers port 3000 over the drone daemon port', () => {
    const selected = resolveDefaultPreviewPort([port(3000, 43000), port(7777, 47777)], 7777);

    expect(selected).toEqual(port(3000, 43000));
  });

  test('prefers a non-system port when only unknown app ports are available', () => {
    const selected = resolveDefaultPreviewPort([port(4000, 44000), port(7777, 47777)], 7777);

    expect(selected).toEqual(port(4000, 44000));
  });

  test('falls back to the configured default port when no better preview port exists', () => {
    const selected = resolveDefaultPreviewPort([port(7777, 47777)], 7777);

    expect(selected).toEqual(port(7777, 47777));
  });
});
