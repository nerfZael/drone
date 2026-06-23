import { describe, expect, test } from 'bun:test';
import { collectInlineAgentMedia } from '../src/droneHub/chat/inline-agent-media';

describe('collectInlineAgentMedia', () => {
  test('collects local image and video references from agent text', () => {
    const media = collectInlineAgentMedia(
      ['Screenshot:', 'test-logline.png', '', 'Video:', 'recordings/session.webm'].join('\n'),
      'drone-1',
      '/work/repo',
    );

    expect(media.map((item) => ({ kind: item.kind, label: item.label, path: item.fileRef?.path }))).toEqual([
      { kind: 'image', label: 'test-logline.png', path: '/work/repo/test-logline.png' },
      { kind: 'video', label: 'session.webm', path: '/work/repo/recordings/session.webm' },
    ]);
    expect(media[1]?.src).toBe('/api/drones/drone-1/fs/media?path=%2Fwork%2Frepo%2Frecordings%2Fsession.webm');
  });

  test('collects markdown video links', () => {
    const media = collectInlineAgentMedia('Video: [session.webm](artifacts/session.webm)', 'drone-1', '/dvm-data/home');

    expect(media).toHaveLength(1);
    expect(media[0]?.kind).toBe('video');
    expect(media[0]?.label).toBe('session.webm');
    expect(media[0]?.fileRef?.path).toBe('/dvm-data/home/artifacts/session.webm');
  });

  test('collects http video links from path and query params', () => {
    const media = collectInlineAgentMedia(
      [
        'https://example.com/files/session.mp4',
        'https://example.com/download?path=%2Ftmp%2Fsession.webm',
      ].join('\n'),
    );

    expect(media.map((item) => ({ kind: item.kind, src: item.src }))).toEqual([
      { kind: 'video', src: 'https://example.com/files/session.mp4' },
      { kind: 'video', src: 'https://example.com/download?path=%2Ftmp%2Fsession.webm' },
    ]);
  });
});
