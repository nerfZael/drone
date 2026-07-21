import { describe, expect, test } from 'bun:test';
import {
  inferMobilePreviewMime,
  isCodePreview,
  isMarkdownPreview,
  mobileWorkspaceRelativeFilePath,
  resolveMobileDroneFilePath,
} from '../src/drones/file-preview-model';

describe('mobile file preview model', () => {
  test('maps container paths into the selected drone repository', () => {
    const drone = {
      runtime: 'container',
      repoPath: '/host/projects/drone',
      cwd: '',
      repoAttached: true,
    };
    expect(resolveMobileDroneFilePath(drone as any, 'src/index.ts')).toBe(
      '/work/repo/src/index.ts',
    );
    expect(resolveMobileDroneFilePath(drone as any, '/host/projects/drone/README.md')).toBe(
      '/work/repo/README.md',
    );
  });

  test('maps container-style references back to a host drone repository', () => {
    const drone = { runtime: 'host', repoPath: '/srv/drone', cwd: '', repoAttached: true };
    expect(resolveMobileDroneFilePath(drone as any, '/work/repo/src/index.ts')).toBe(
      '/srv/drone/src/index.ts',
    );
    expect(resolveMobileDroneFilePath(drone as any, 'README.md')).toBe('/srv/drone/README.md');
  });

  test('uses the working directory for a host drone without a repository', () => {
    const drone = { runtime: 'host', repoPath: '', cwd: '/srv/scratch', repoAttached: false };
    expect(resolveMobileDroneFilePath(drone, 'notes.txt')).toBe('/srv/scratch/notes.txt');
  });

  test('uses container home when a known repository is not attached', () => {
    const drone = {
      runtime: 'container',
      repoPath: '/host/projects/drone',
      cwd: '',
      repoAttached: false,
    };
    expect(resolveMobileDroneFilePath(drone, 'notes.txt')).toBe('/dvm-data/home/notes.txt');
  });

  test('shows file paths relative to the active workspace root', () => {
    expect(
      mobileWorkspaceRelativeFilePath(
        {
          runtime: 'container',
          repoPath: '/host/projects/drone',
          cwd: '',
          repoAttached: true,
        },
        '/work/repo/src/index.ts',
      ),
    ).toBe('src/index.ts');
    expect(
      mobileWorkspaceRelativeFilePath(
        { runtime: 'host', repoPath: '/srv/drone', cwd: '/srv/drone', repoAttached: true },
        '/srv/drone/README.md',
      ),
    ).toBe('README.md');
    expect(
      mobileWorkspaceRelativeFilePath(
        { runtime: 'host', repoPath: '', cwd: '/srv/scratch', repoAttached: false },
        '/srv/scratch/output/result.json',
      ),
    ).toBe('output/result.json');
    expect(
      mobileWorkspaceRelativeFilePath(
        { runtime: 'host', repoPath: '', cwd: '', repoAttached: false },
        'artifacts/report.md',
      ),
    ).toBe('artifacts/report.md');
  });

  test('separates Markdown, code, and ordinary text previews', () => {
    expect(isMarkdownPreview('/work/repo/README.md', 'text/plain')).toBe(true);
    expect(isMarkdownPreview('/work/repo/README', 'text/plain')).toBe(true);
    expect(isMarkdownPreview('/work/repo/README.txt', 'text/plain')).toBe(false);
    expect(isCodePreview('/work/repo/src/index.ts', 'text/plain')).toBe(true);
    expect(isCodePreview('/work/repo/notes.txt', 'text/plain')).toBe(false);
  });

  test('recognizes the supported image and video extensions', () => {
    expect(inferMobilePreviewMime('assets/icon.tiff')).toBe('image/tiff');
    expect(inferMobilePreviewMime('recordings/demo.mkv')).toBe('video/x-matroska');
  });
});
