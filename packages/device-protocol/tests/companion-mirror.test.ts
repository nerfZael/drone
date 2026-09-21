import { expect, test } from 'bun:test';
import { COMPANION_CAPABILITY, isGranted } from '../src/capabilities';
import { capabilityEventPolicy } from '../src/capability-events';

test('existing run grants cover mirror publications but never settings writes', () => {
  const grants = [{ capability: 'companion', version: 1, operations: ['run.start'] }];
  for (const operation of ['mirror.settings.get', 'mirror.publish', 'mirror.close', 'mirror.result']) {
    expect(COMPANION_CAPABILITY.operations).toContain(operation);
    expect(isGranted(grants, 'companion', 1, operation)).toBe(true);
    expect(isGranted([], 'companion', 1, operation)).toBe(false);
  }
  expect(isGranted(grants, 'companion', 1, 'auto-approve.settings.update')).toBe(false);
  expect(capabilityEventPolicy('companion', 'mirror.command')?.requiredOperation).toBe('run.start');
  expect(capabilityEventPolicy('companion', 'auto-approve.settings.changed')?.requiredOperation).toBe('auto-approve.settings.get');
});
