import { describe, expect, test } from 'bun:test';
import { installBlipCliScript, installFleetCliScript, installTasksCliScript } from '../src/host/runtime';

describe('installFleetCliScript', () => {
  test('installs a fleet wrapper on PATH that points at the in-container runtime', () => {
    const script = installFleetCliScript();
    expect(script).toContain('mkdir -p');
    expect(script).toContain('/usr/local/bin/fleet');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain("exec node '/dvm-data/drone/dist/fleet.js' \"$@\"");
    expect(script).toContain('chmod 755');
  });
});

describe('installTasksCliScript', () => {
  test('installs a tasks wrapper on PATH that points at the in-container runtime', () => {
    const script = installTasksCliScript();
    expect(script).toContain('mkdir -p');
    expect(script).toContain('/usr/local/bin/tasks');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain("exec node '/dvm-data/drone/dist/tasks.js' \"$@\"");
    expect(script).toContain('chmod 755');
  });
});

describe('installBlipCliScript', () => {
  test('installs a blip wrapper on PATH that points at the in-container runtime', () => {
    const script = installBlipCliScript();
    expect(script).toContain('mkdir -p');
    expect(script).toContain('/usr/local/bin/blip');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain("exec node '/dvm-data/drone/dist/blip.js' \"$@\"");
    expect(script).toContain('chmod 755');
  });
});
