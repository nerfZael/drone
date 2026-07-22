import { describe, expect, test } from 'bun:test';
import { clampImagePreviewOffset, clampImagePreviewScale } from '../src/drones/image-preview-zoom';

describe('mobile image preview zoom', () => {
  test('bounds zoom and pan values', () => {
    expect(clampImagePreviewScale(0.5)).toBe(1);
    expect(clampImagePreviewScale(3)).toBe(3);
    expect(clampImagePreviewScale(8)).toBe(5);
    expect(clampImagePreviewOffset(180, 200, 2)).toBe(100);
    expect(clampImagePreviewOffset(-180, 200, 2)).toBe(-100);
    expect(clampImagePreviewOffset(20, 200, 1)).toBe(0);
  });
});
