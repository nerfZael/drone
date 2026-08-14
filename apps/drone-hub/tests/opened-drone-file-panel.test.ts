import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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

function renderPanel(file: DroneOpenedFileState, withTab = false): string {
  return renderToStaticMarkup(
    React.createElement(OpenedDroneFilePanel, {
      droneId: 'drone-1',
      file,
      ...(withTab
        ? {
            fileTabs: [{ ...file, droneId: 'drone-1', tabId: `drone-1:${file.path}` }],
            activeTabId: `drone-1:${file.path}`,
          }
        : {}),
    }),
  );
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

  test('keeps Monaco pointer tooltips from blocking narrow editor controls', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const pointerTooltipRule =
      /\.workbench-hover-container:has\(> \.workbench-hover-pointer\)[^{]*\{([^}]*)\}/.exec(styles)?.[1];

    expect(pointerTooltipRule).toContain('pointer-events: none');
  });

  test('uses the slim shared Monaco scrollbar in file and chat editors', () => {
    const loaderSource = readFileSync(
      new URL('../src/droneHub/files/monaco-editor-loader.tsx', import.meta.url),
      'utf8',
    );
    const fileEditorSource = readFileSync(
      new URL('../src/droneHub/files/OpenedDroneFilePanel.tsx', import.meta.url),
      'utf8',
    );
    const chatEditorSource = readFileSync(
      new URL('../src/droneHub/chat/ChatComposerEditor.tsx', import.meta.url),
      'utf8',
    );

    expect(loaderSource).toContain('verticalScrollbarSize: 4');
    expect(loaderSource).toContain('horizontalScrollbarSize: 4');
    expect(fileEditorSource).toContain('scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS');
    expect(chatEditorSource).toContain('scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS');
  });

  test('uses the tab strip as the only file header', () => {
    const html = renderPanel(makeFile({ dirty: true }), true);

    expect(html).toContain('index.ts<span aria-hidden="true">*</span>');
    expect(html).not.toContain('Unsaved changes');
    expect(html).not.toContain('>Saved<');
    expect(html).not.toContain('/work/repo/src/index.ts');
    expect(html).not.toContain('>Save<');
    expect(html).not.toContain('>Definition<');
    expect(html).not.toContain('>References<');
    expect(html).not.toContain('aria-label="Go back"');
    expect(html).not.toContain('aria-label="Go forward"');
  });

  test('offers a full-screen reading action in the file tab strip', () => {
    const html = renderPanel(makeFile({}), true);

    expect(html).toContain('aria-label="Enter full screen"');
    expect(html).toContain('aria-pressed="false"');
  });

  test('shows one contextual markdown view action and compact heading controls', () => {
    const html = renderPanel(
      makeFile({
        path: '/work/repo/README.md',
        name: 'README.md',
        mime: 'text/markdown',
        content: '# Readme',
      }),
      true,
    );

    expect(html).toContain('aria-label="Open files"');
    expect(html).toContain('aria-label="Copy file contents"');
    expect(html).toContain('aria-label="Heading expansion"');
    expect(html).toContain('aria-label="Collapse all Markdown headings"');
    expect(html).toContain('aria-label="Expand all Markdown headings"');
    expect(html).toContain('dh-markdown--document');
    expect(html).toContain('>Edit</button>');
    expect(html).not.toContain('>Preview</button>');
    expect(html).not.toContain('>Outline</button>');
    expect(html).not.toContain('>Saved<');
  });

  test('renders HTML in a script-capable opaque sandbox', () => {
    const html = renderPanel(
      makeFile({
        path: '/work/repo/index.html',
        name: 'index.html',
        mime: 'text/html',
        content: '<h1>Preview</h1><script>window.previewRan = true</script>',
      }),
      true,
    );

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('allow-forms');
    expect(html).toContain('credentialless=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('camera');
    expect(html).toContain('clipboard-read');
    expect(html).toContain('Isolated preview: scripts run; network, storage, and DroneHub access are blocked.');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('connect-src');
    expect(html).toContain('window.previewRan');
    expect(html).toContain('aria-label="Copy file contents"');
    expect(html).toContain('>Edit</button>');
    expect(html).not.toContain('Plain text editor');
  });

  test('does not show the copy action while a text file is in edit mode', () => {
    const html = renderPanel(makeFile({ path: '/work/repo/src/index.ts', name: 'index.ts' }), true);

    expect(html).not.toContain('aria-label="Copy file contents"');
  });

  test('renders oversized text files in the large-file viewer', () => {
    const html = renderPanel(makeFile({ kind: 'large-text', size: 30 * 1024 * 1024, content: '' }));

    expect(html).toContain('Large file');
    expect(html).toContain('Load more');
    expect(html).not.toContain('Loading editor...');
  });

  test('keys media previews by revision so external changes bypass browser caches', () => {
    const html = renderPanel(
      makeFile({
        path: '/work/repo/assets/image.png',
        name: 'image.png',
        kind: 'image',
        mime: 'image/png',
        revision: 'sha256:changed',
      }),
    );

    expect(html).toContain('revision=sha256%3Achanged');
  });

  test('warns before replacing dirty content that changed on disk', () => {
    const html = renderPanel(makeFile({ dirty: true, externallyChanged: true }));

    expect(html).toContain('changed on disk while you have unsaved edits');
    expect(html).toContain('Reload from disk');
  });
});
