import { describe, expect, test } from 'bun:test';

import { desktopFileMediaUrl, desktopFileReadUrl } from '../src/droneHub/files/file-read-url';
import { desktopMediaFileKindForExtension } from '../src/droneHub/files/desktop-media-file-kind';

describe('desktopFileReadUrl', () => {
  test('shares one image and video extension policy', () => {
    expect(desktopMediaFileKindForExtension('png')).toBe('image');
    expect(desktopMediaFileKindForExtension('tiff')).toBe('image');
    expect(desktopMediaFileKindForExtension('mp4')).toBe('video');
    expect(desktopMediaFileKindForExtension('wmv')).toBe('video');
    expect(desktopMediaFileKindForExtension('md')).toBeNull();
  });

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

describe('desktopFileMediaUrl', () => {
  test('checks sha256 revisions on the media route', () => {
    expect(desktopFileMediaUrl('drone', '/work/clip.mp4', 'sha256:abc')).toBe(
      '/api/drones/drone/fs/media?path=%2Fwork%2Fclip.mp4&revision=sha256%3Aabc',
    );
  });

  test('sends metadata revisions of large files as an unchecked cache key', () => {
    const url = new URL(
      desktopFileMediaUrl('drone', '/tmp/side-by-side.mp4', 'metadata:12588070:1792068673000'),
      'http://local',
    );
    expect(url.searchParams.get('revision')).toBeNull();
    expect(url.searchParams.get('v')).toBe('metadata:12588070:1792068673000');
  });

  test('leaves the revision out when there is none', () => {
    expect(desktopFileMediaUrl('drone', '/work/photo.png', null)).toBe(
      '/api/drones/drone/fs/media?path=%2Fwork%2Fphoto.png',
    );
  });
});
