import { describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DroneOpenedFileState } from '../src/droneHub/files/opened-file-types';

let monacoImportCount = 0;

mock.module('@monaco-editor/react', () => {
  monacoImportCount += 1;
  return {
    default: function MockMonacoEditor() {
      return React.createElement('div', { 'data-testid': 'mock-monaco-editor' });
    },
  };
});

const { OpenedDroneFilePanel } = await import('../src/droneHub/files/OpenedDroneFilePanel');

function makeFile(overrides: Partial<DroneOpenedFileState>): DroneOpenedFileState {
  return {
    path: '/work/repo/src/index.ts',
    name: 'index.ts',
    loading: false,
    saving: false,
    error: null,
    kind: 'text',
    mime: 'text/plain',
    size: 12,
    content: 'const value = 1;',
    dirty: false,
    mtimeMs: null,
    targetLine: null,
    targetColumn: null,
    navigationSeq: 1,
    ...overrides,
  };
}

function renderPanel(file: DroneOpenedFileState): string {
  return renderToStaticMarkup(React.createElement(OpenedDroneFilePanel, { droneId: 'drone-1', file }));
}

describe('OpenedDroneFilePanel', () => {
  test('loads Monaco only for text edit mode', async () => {
    renderPanel(
      makeFile({
        path: '/work/repo/assets/image.png',
        name: 'image.png',
        kind: 'image',
        mime: 'image/png',
      }),
    );
    renderPanel(
      makeFile({
        path: '/work/repo/README.md',
        name: 'README.md',
        mime: 'text/markdown',
        content: '# Readme',
      }),
    );
    renderPanel(
      makeFile({
        path: '/work/repo/assets/video.mp4',
        name: 'video.mp4',
        kind: 'video',
        mime: 'video/mp4',
      }),
    );
    renderPanel(
      makeFile({
        path: '/work/repo/archive.zip',
        name: 'archive.zip',
        kind: 'binary',
        mime: 'application/zip',
      }),
    );
    renderPanel(
      makeFile({
        path: null,
        name: null,
        content: '',
      }),
    );

    expect(monacoImportCount).toBe(0);

    const html = renderPanel(makeFile({ path: '/work/repo/src/index.ts', name: 'index.ts' }));
    await Promise.resolve();

    expect(html).toContain('Plain text editor');
    expect(monacoImportCount).toBe(1);
  });

  test('disables language actions for unsaved text files', () => {
    const html = renderPanel(makeFile({ dirty: true }));

    expect(html).toContain('Save before using go to definition');
    expect(html).toContain('Save before finding references');
  });

  test('renders oversized text files in the large-file viewer', () => {
    const html = renderPanel(makeFile({ kind: 'large-text', size: 30 * 1024 * 1024, content: '' }));

    expect(html).toContain('Large file');
    expect(html).toContain('Load more');
    expect(html).not.toContain('Loading editor...');
  });
});
