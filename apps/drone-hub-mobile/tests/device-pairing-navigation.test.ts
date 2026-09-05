import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('pairing belongs to Devices, not a separate Settings tab', () => {
  const shell = source('shell/MeshApp.tsx');
  expect(shell).toContain("setPairReturnTab('devices')");
  expect(shell).toContain('<DevicesScreen onPair={openPairing} />');
  expect(source('screens/SettingsScreen.tsx')).not.toContain("value: 'pairing'");
});

test('only the selected pairing method is mounted and pending approval replaces the form', () => {
  const pair = source('screens/PairScreen.tsx');
  expect(pair).toContain("('nearby')");
  expect(pair).toContain("method === 'nearby'");
  expect(pair).toContain("method === 'qr'");
  expect(pair).toContain("method === 'address'");
  expect(pair).toContain("method === 'code'");
  expect(pair).toContain('!pairing &&');
  expect(pair).not.toContain('private key');
  expect(pair).not.toContain('THIS DEVICE');
});

test('adding a device protects unsaved permission edits', () => {
  const devices = source('screens/DevicesScreen.tsx');
  expect(devices).toContain('permissionsDirty ? setPendingPair(true) : onPair()');
  expect(devices).toContain('Boolean(pendingDeviceId) || pendingPair');
});

test('pairing cancellation is checked before persisting an approved profile', () => {
  const context = source('mesh/MeshContext.tsx');
  const pairing = context.slice(
    context.indexOf('async (payload: PairingPayload'),
    context.indexOf('const forgetMesh'),
  );
  expect(pairing).toContain('signal.throwIfAborted();\n      await saveMeshProfile(next);');
  const screen = source('screens/PairScreen.tsx');
  expect(screen).toContain('alive.current && !controller.signal.aborted');
  expect(screen).toContain("!alive.current || methodRef.current !== 'qr'");
});
