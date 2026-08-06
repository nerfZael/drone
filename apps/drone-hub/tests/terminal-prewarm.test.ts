import { describe, expect, test } from 'bun:test';
import { shellTerminalPrewarmKey, shouldPrewarmShellTerminal } from '../src/droneHub/app/terminal-prewarm';
import type { DroneSummary } from '../src/droneHub/types';

function makeDrone(overrides?: Partial<DroneSummary>): DroneSummary {
  return {
    id: 'drone-1',
    name: 'drone-1',
    runtime: 'container',
    statusOk: true,
    statusError: null,
    cwd: '/work/repo',
    repoPath: '/work/repo',
    repoAttached: true,
    chats: ['default'],
    ports: [],
    envVars: [],
    hubPhase: null,
    hubMessage: null,
    busy: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  } as DroneSummary;
}

describe('terminal prewarm helpers', () => {
  test('builds a stable prewarm key from drone id and cwd', () => {
    expect(shellTerminalPrewarmKey({ droneId: 'drone-1', cwd: '/work/repo' })).toBe('drone-1\u0000/work/repo');
  });

  test('prewarms ready container drones while terminal is not visible', () => {
    expect(
      shouldPrewarmShellTerminal({
        drone: makeDrone(),
        cwd: '/work/repo',
        visibleToolTabs: ['preview'],
      }),
    ).toBe(true);
  });

  test('does not prewarm host runtime drones', () => {
    expect(
      shouldPrewarmShellTerminal({
        drone: makeDrone({ runtime: 'host' }),
        cwd: '/work/repo',
        visibleToolTabs: ['preview'],
      }),
    ).toBe(false);
  });

  test('does not prewarm while the drone is still provisioning', () => {
    expect(
      shouldPrewarmShellTerminal({
        drone: makeDrone({ hubPhase: 'starting' }),
        cwd: '/work/repo',
        visibleToolTabs: ['preview'],
      }),
    ).toBe(false);
  });

  test('does not prewarm when the terminal tab is already open', () => {
    expect(
      shouldPrewarmShellTerminal({
        drone: makeDrone(),
        cwd: '/work/repo',
        visibleToolTabs: ['terminal'],
      }),
    ).toBe(false);
  });

  test('does not prewarm a fresh chat-only workspace', () => {
    expect(
      shouldPrewarmShellTerminal({
        drone: makeDrone(),
        cwd: '/work/repo',
        visibleToolTabs: [],
      }),
    ).toBe(false);
  });
});
