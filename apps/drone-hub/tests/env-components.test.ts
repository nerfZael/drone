import { describe, expect, test } from 'bun:test';
import { DroneEnvDock } from '../src/droneHub/env';
import { ReposModal } from '../src/droneHub/app/ReposModal';

describe('env component modules', () => {
  test('exports the drone env dock', () => {
    expect(typeof DroneEnvDock).toBe('function');
  });

  test('exports the repository modal', () => {
    expect(typeof ReposModal).toBe('function');
  });
});
