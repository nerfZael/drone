import { describe, expect, test } from 'bun:test';
import { isMobileDroneStarting } from '../src/drones/isMobileDroneStarting';

describe('mobile drone starting state', () => {
  test('recognizes every supported starting phase', () => {
    expect(isMobileDroneStarting({ phase: 'starting' })).toBe(true);
    expect(isMobileDroneStarting({ phase: ' Creating ' })).toBe(true);
    expect(isMobileDroneStarting({ phase: 'SEEDING' })).toBe(true);
    expect(isMobileDroneStarting({ phase: 'running' })).toBe(false);
    expect(isMobileDroneStarting({ phase: 'error' })).toBe(false);
  });
});
