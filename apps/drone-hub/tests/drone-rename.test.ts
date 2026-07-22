import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  droneRenameErrorMessage,
  validateDroneRename,
} from '../src/droneHub/app/drone-rename';

const mutationActionsSource = readFileSync(
  join(import.meta.dir, '../src/droneHub/app/use-drone-mutation-actions.ts'),
  'utf8',
);

describe('drone rename', () => {
  test('validates names using the rename API limits', () => {
    expect(validateDroneRename('  new-name  ', 'old-name')).toBeNull();
    expect(validateDroneRename('   ', 'old-name')).toBe('Enter a drone name.');
    expect(validateDroneRename('old-name', 'old-name')).toBe('Enter a different name.');
    expect(validateDroneRename('line one\nline two', 'old-name')).toBe(
      'Drone names cannot contain newlines.',
    );
    expect(validateDroneRename('x'.repeat(81), 'old-name')).toBe(
      'Drone names must be 80 characters or fewer.',
    );
  });

  test('turns known mutation failures into useful inline errors', () => {
    expect(droneRenameErrorMessage('name already exists')).toBe(
      'A drone with that name already exists.',
    );
    expect(droneRenameErrorMessage('drone "draft" is still starting')).toBe(
      'This drone is still starting. Try again in a moment.',
    );
    expect(droneRenameErrorMessage('Server unavailable')).toBe('Server unavailable');
  });

  test('does not fall back to the native browser prompt', () => {
    expect(mutationActionsSource).not.toContain('window.prompt');
    expect(mutationActionsSource).toContain('setRenameDroneTarget');
  });
});
