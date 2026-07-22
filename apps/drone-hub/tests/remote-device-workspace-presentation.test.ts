import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('remote device workspace presentation', () => {
  test('explains offline and empty-device states without exposing transport language', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/RemoteDeviceWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('mesh route');
    expect(source).not.toContain('Choose a remote drone');
    expect(source).toContain('title={`${deviceName} is offline`}');
    expect(source).toContain('title="No drones on this device"');
    expect(source).toContain("'Offline · reconnecting automatically'");
    expect(source).toContain('Retry connection');
    expect(source).toContain('Checking automatically');
    expect(source).toContain("'Checking access'");
    expect(source).toContain("'Control unavailable'");
    expect(source).toContain('This chat is still readable, but sending is paused');
  });
});
