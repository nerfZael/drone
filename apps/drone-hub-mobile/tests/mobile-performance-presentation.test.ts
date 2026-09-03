import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile performance presentation', () => {
  test('does not refetch creation options after the initial drone list', () => {
    const source = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    const loadDrones = source.slice(
      source.indexOf('const loadDrones = React.useCallback'),
      source.indexOf('loadDronesRef.current = loadDrones'),
    );

    expect(loadDrones.match(/requestDroneControl\(targetId, 'drones\.list'/g)).toHaveLength(1);
    expect(loadDrones).toContain('includeCreateOptions: false');
    expect(source).toContain(
      "requestDroneControl(destinationId, 'drones.list', { includeCreateOptions: true })",
    );
  });
});
