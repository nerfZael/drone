import { describe, expect, test } from 'bun:test';
import { collectInlineAgentMedia } from '../src/droneHub/chat/inline-agent-media';

describe('collectInlineAgentMedia', () => {
  test('uses the image folder before the filename, not a later comparison folder', () => {
    const text = 'I rebuilt the ore concepts. There are two now, A and B, in ' +
      '`graphics-review/environment/ore/`: `ore-r2-side-by-side.png` shows both, and the ' +
      'round-1 versions are in `round-1/` for comparison.';
    const media = collectInlineAgentMedia(text, 'drone-1', '/work/repo');
    expect(media.map(item => item.fileRef?.path)).toEqual([
      '/work/repo/graphics-review/environment/ore/ore-r2-side-by-side.png',
    ]);
  });

  test('resolves each paragraph independently, including repeated filenames', () => {
    const media = collectInlineAgentMedia(
      'Before in `before/`: `result.png`.\n\nAfter in `after/`: `result.png`.',
      'drone-1', '/work/repo',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual(['/work/repo/before/result.png', '/work/repo/after/result.png']);
  });

  test('resolves image filenames against the explicit directory in the message', () => {
    const media = collectInlineAgentMedia(
      'The renders in `/work/repo/graphics-review/seedship-v3-concepts/` are updated ' +
        '(`seedship-flying.png` from the back, `seedship-flying-bow.png` from the front).',
      'drone-1', '/work/repo',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual([
      '/work/repo/graphics-review/seedship-v3-concepts/seedship-flying.png',
      '/work/repo/graphics-review/seedship-v3-concepts/seedship-flying-bow.png',
    ]);
  });

  test('prefers an explicit file reference over duplicate short filename mentions', () => {
    const media = collectInlineAgentMedia(
      '`result.png` is ready. [Open result](graphics/result.png).', 'drone-1', '/work/repo',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual(['/work/repo/graphics/result.png']);
  });

  test('does not guess a directory when the message names several possible folders', () => {
    const media = collectInlineAgentMedia(
      'Compare `/work/repo/before/` and `/work/repo/after/`. `result.png`', 'drone-1', '/work/repo',
    );
    expect(media[0]?.fileRef?.path).toBe('/work/repo/result.png');
  });

  test('keeps explicitly located images distinct when they share a filename', () => {
    const media = collectInlineAgentMedia(
      'Compare `before/result.png` and `after/result.png`; `result.png` changed.', 'drone-1', '/work/repo',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual(['/work/repo/before/result.png', '/work/repo/after/result.png']);
  });

  test('preserves absolute paths and resolves a host-relative output directory', () => {
    const media = collectInlineAgentMedia(
      'Output in `screenshots/`: `result.png`, `/tmp/other.png`, and `recording.webm`.',
      'host-drone', '/home/dev/project',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual([
      '/home/dev/project/screenshots/result.png', '/tmp/other.png', '/home/dev/project/screenshots/recording.webm',
    ]);
    expect(media[2]?.kind).toBe('video');
  });

  test('does not use URLs or parent traversal as a local output directory', () => {
    const media = collectInlineAgentMedia(
      'See `https://example.com/images/` and `../outside/`: `result.png`.', 'drone-1', '/work/repo',
    );
    expect(media.map(item => item.fileRef?.path)).toEqual(['/work/repo/result.png']);
  });

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
