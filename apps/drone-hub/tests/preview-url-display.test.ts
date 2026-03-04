import { describe, expect, test } from 'bun:test';
import { displayUrlForPreviewInput } from '../src/droneHub/overview/helpers';

describe('displayUrlForPreviewInput', () => {
  test('shows container port for preview proxy URLs', () => {
    expect(
      displayUrlForPreviewInput('/api/drones/drone-1/preview/3000/app?x=1#hash'),
    ).toBe('http://localhost:3000/app?x=1#hash');
    expect(
      displayUrlForPreviewInput('/api/drones/drone-1/preview-open/5173/'),
    ).toBe('http://localhost:5173/');
  });

  test('shows container port for mapped localhost host ports', () => {
    const rows = [
      { containerPort: 3000, hostPort: 45123 },
      { containerPort: 5173, hostPort: 45124 },
    ];
    expect(
      displayUrlForPreviewInput('http://localhost:45123/docs?q=ports', rows),
    ).toBe('http://localhost:3000/docs?q=ports');
  });

  test('leaves unrelated URLs unchanged', () => {
    const rows = [{ containerPort: 3000, hostPort: 45123 }];
    expect(displayUrlForPreviewInput('https://example.com/path', rows)).toBe(
      'https://example.com/path',
    );
    expect(displayUrlForPreviewInput('http://localhost:9999/path', rows)).toBe(
      'http://localhost:9999/path',
    );
  });
});
