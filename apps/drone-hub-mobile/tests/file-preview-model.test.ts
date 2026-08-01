import { describe, expect, test } from 'bun:test';
import {
  inferMobilePreviewMime,
  isCodePreview,
  isHtmlPreview,
  isMarkdownPreview,
  isRenderedHtmlPreviewAvailable,
  mobileHtmlPreviewMode,
  mobileTextPreviewContent,
  MOBILE_FORMATTED_TEXT_PREVIEW_MAX_CHARS,
  MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS,
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

  test('falls back to bounded plain text for large files', () => {
    expect(mobileTextPreviewContent('short')).toEqual({
      content: 'short',
      formatted: true,
      truncated: false,
    });
    expect(
      mobileTextPreviewContent('x'.repeat(MOBILE_FORMATTED_TEXT_PREVIEW_MAX_CHARS + 1)),
    ).toMatchObject({ formatted: false, truncated: false });
    const oversized = mobileTextPreviewContent(
      'x'.repeat(MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS + 1),
    );
    expect(oversized).toMatchObject({ formatted: false, truncated: true });
    expect(oversized.content).toHaveLength(MOBILE_RENDERED_TEXT_PREVIEW_MAX_CHARS);
  });

  test('detects HTML by supported path or MIME type', () => {
    expect(isHtmlPreview('/work/repo/report.html', 'text/plain')).toBe(true);
    expect(isHtmlPreview('/work/repo/report.HTM', 'text/plain')).toBe(true);
    expect(isHtmlPreview('/work/repo/report.xhtml', 'text/plain')).toBe(true);
    expect(isHtmlPreview('/work/repo/report', 'text/html; charset=utf-8')).toBe(true);
    expect(isHtmlPreview('/work/repo/report.xml', 'application/xhtml+xml')).toBe(true);
    expect(isHtmlPreview('/work/repo/report.ts', 'text/plain')).toBe(false);
  });

  test('defaults HTML to rendered mode and preserves source mode across refreshes', () => {
    expect(
      mobileHtmlPreviewMode({
        path: '/work/repo/report.html',
        mime: 'text/html',
        renderingAvailable: true,
        selection: null,
      }),
    ).toBe('rendered');

    const sourceSelection = { path: '/work/repo/report.html', mode: 'source' as const };
    expect(
      mobileHtmlPreviewMode({
        path: '/work/repo/report.html',
        mime: 'text/html',
        renderingAvailable: true,
        selection: sourceSelection,
      }),
    ).toBe('source');
    expect(
      mobileHtmlPreviewMode({
        path: '/work/repo/next.html',
        mime: 'text/html',
        renderingAvailable: true,
        selection: sourceSelection,
      }),
    ).toBe('rendered');
  });

  test('uses a source-only fallback where rendered HTML is unavailable', () => {
    expect(isRenderedHtmlPreviewAvailable('android')).toBe(true);
    expect(isRenderedHtmlPreviewAvailable('ios')).toBe(true);
    expect(isRenderedHtmlPreviewAvailable('web')).toBe(false);
    expect(
      mobileHtmlPreviewMode({
        path: '/work/repo/report.html',
        mime: 'text/html',
        renderingAvailable: false,
        selection: { path: '/work/repo/report.html', mode: 'rendered' },
      }),
    ).toBe('source');
  });

  test('recognizes the supported image and video extensions', () => {
    expect(inferMobilePreviewMime('assets/icon.tiff')).toBe('image/tiff');
    expect(inferMobilePreviewMime('recordings/demo.mkv')).toBe('video/x-matroska');
    expect(inferMobilePreviewMime('reports/demo.html')).toBe('text/html');
  });
});
