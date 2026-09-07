import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DroneEditorWorkspace } from '../src/droneHub/app/DroneEditorWorkspace';
import { EditorPaneContext } from '../src/droneHub/app/editor-pane-context';

for (const pane of ['editor', 'explorer', 'combined'] as const) {
  test(`renders the ${pane} workspace content`, () => {
    const html = renderToStaticMarkup(
      <EditorPaneContext.Provider value={pane}>
        <DroneEditorWorkspace
          explorer={() => <div data-test-explorer="1" />}
          editor={<div data-test-editor="1" />}
        />
      </EditorPaneContext.Provider>,
    );
    expect(html.includes('data-test-explorer')).toBe(pane !== 'editor');
    expect(html.includes('data-test-editor')).toBe(pane !== 'explorer');
    expect(html.includes('Resize File Explorer')).toBe(pane === 'combined');
    expect(html.includes('Explorer zoom')).toBe(pane === 'combined');
  });
}
