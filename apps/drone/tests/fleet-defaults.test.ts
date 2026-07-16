import { describe, expect, test } from 'bun:test';
import { fleetActorConfig } from '../src/hub/fleet-helpers';

describe('fleetActorConfig defaults', () => {
  test('defaults missing relationship fields', () => {
    const config = fleetActorConfig({});
    expect(config).toEqual({ assigned: [], createdBy: null, createdAt: null });
  });

  test('normalizes assigned and parent relationships', () => {
    const config = fleetActorConfig({ fleet: { assigned: [' child ', '', 'child'], createdBy: ' parent ' } });
    expect(config).toEqual({ assigned: ['child'], createdBy: 'parent', createdAt: null });
  });
});
