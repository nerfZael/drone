import { describe, expect, test } from 'bun:test';

import { desktopFileReadUrl } from '../src/droneHub/files/file-read-url';

describe('desktopFileReadUrl', () => {
  test('requests metadata only for image and video previews', () => {
    expect(desktopFileReadUrl('drone one', '/work/photo.PNG')).toBe(
      '/api/drones/drone%20one/fs/file?path=%2Fwork%2Fphoto.PNG&metadata=1',
    );
    expect(desktopFileReadUrl('drone', '/work/movie.mp4')).toContain('&metadata=1');
  });

  test('continues reading text and unknown files through the content endpoint', () => {
    expect(desktopFileReadUrl('drone', '/work/readme.md')).toBe(
      '/api/drones/drone/fs/file?path=%2Fwork%2Freadme.md',
    );
    expect(desktopFileReadUrl('drone', '/work/archive.bin')).not.toContain('metadata=1');
  });

  test('treats question marks and fragments as literal Unix filename characters', () => {
    for (const filePath of [
      '/work/notes.png?draft.md',
      '/work/notes.png#draft.md',
      '/work/space name.png\tdraft.md',
      '/work/space name.png\ndraft.md',
      '/work/notes.png trailing.md ',
    ]) {
      const url = desktopFileReadUrl('drone', filePath);
      expect(url).not.toContain('metadata=1');
      expect(new URL(url, 'http://local').searchParams.get('path')).toBe(filePath);
    }
  });
});
