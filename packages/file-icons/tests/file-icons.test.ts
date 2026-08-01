import { describe, expect, test } from 'bun:test';
import { fileIconIdForPath, fileIconSvg, folderIconIdForPath, type FileIconId } from '../src';

const fileCases: Array<[string, FileIconId]> = [
  ['src/index.ts', 'typescript'],
  ['src/view.tsx', 'react_ts'],
  ['src/view.test.tsx', 'test-jsx'],
  ['types/runtime.d.ts', 'typescript-def'],
  ['README.md', 'readme'],
  ['docs/guide.mdx', 'mdx'],
  ['package.json', 'nodejs'],
  ['vite.config.ts', 'vite'],
  ['Dockerfile', 'docker'],
  ['bun.lock', 'bun'],
  ['schema.prisma', 'prisma'],
  ['assets/photo.webp', 'image'],
  ['db/query.sql', 'database'],
  ['include/runtime.hpp', 'hpp'],
  ['android/MainActivity.kt', 'kotlin'],
  ['ios/AppDelegate.swift', 'swift'],
  ['infra/main.tf', 'terraform'],
  ['notebooks/analysis.ipynb', 'jupyter'],
];

describe('fileIconIdForPath', () => {
  test.each(fileCases)('%s resolves to %s', (path, expected) => {
    expect(fileIconIdForPath(path)).toBe(expected);
  });

  test('normalizes Windows paths and case', () => {
    expect(fileIconIdForPath('SRC\\APP.TSX')).toBe('react_ts');
  });

  test('falls back for unknown and empty paths', () => {
    expect(fileIconIdForPath('notes.unknown-extension')).toBe('file');
    expect(fileIconIdForPath(null)).toBe('file');
  });

  test('returns complete SVG markup for resolved icons', () => {
    const svg = fileIconSvg(fileIconIdForPath('src/view.tsx'));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

describe('folderIconIdForPath', () => {
  test('uses named closed and open folders', () => {
    expect(folderIconIdForPath('/repo/src')).toBe('folder-src');
    expect(folderIconIdForPath('/repo/src/', true)).toBe('folder-src-open');
  });

  test('covers common mobile project folders', () => {
    expect(folderIconIdForPath('/repo/android')).toBe('folder-android');
    expect(folderIconIdForPath('/repo/ios', true)).toBe('folder-ios-open');
    expect(folderIconIdForPath('/repo/assets')).toBe('folder-resource');
  });

  test('falls back to generic closed and open folders', () => {
    expect(folderIconIdForPath('/repo/unknown-folder')).toBe('folder');
    expect(folderIconIdForPath('/repo/unknown-folder', true)).toBe('folder-open');
  });
});
