import { describe, expect, test } from 'bun:test';
import {
  mobileDroneRenameErrorMessage,
  validateMobileDroneRename,
} from '../src/drones/mobile-drone-rename';

describe('mobile drone rename', () => {
  test('validates the same name limits as desktop', () => {
    expect(validateMobileDroneRename('', 'Current')).toBe('Enter a drone name.');
    expect(validateMobileDroneRename('Current', 'Current')).toBe('Enter a different name.');
    expect(validateMobileDroneRename('Next\nName', 'Current')).toBe(
      'Drone names cannot contain newlines.',
    );
    expect(validateMobileDroneRename('n'.repeat(81), 'Current')).toBe(
      'Drone names must be 80 characters or fewer.',
    );
    expect(validateMobileDroneRename('Next', 'Current')).toBeNull();
  });

  test('turns common Hub failures into useful inline errors', () => {
    expect(mobileDroneRenameErrorMessage('drone already exists: Next')).toBe(
      'A drone with that name already exists.',
    );
    expect(mobileDroneRenameErrorMessage('operation not granted')).toContain('permission');
  });
});
