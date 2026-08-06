import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DroneSummary } from '../src/droneHub/types';

const testWindow = new EventTarget() as EventTarget & {
  localStorage: Storage;
  matchMedia: (query: string) => MediaQueryList;
};
testWindow.localStorage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};
testWindow.matchMedia = (query) =>
  ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }) as MediaQueryList;
(globalThis as any).window = testWindow;
(globalThis as any).localStorage = testWindow.localStorage;

const { DockableDroneWorkspace } = await import(
  '../src/droneHub/app/DockableDroneWorkspace'
);

describe('mobile workspace default layout', () => {
  test('starts a fresh drone with chat only', () => {
    const html = renderToStaticMarkup(
      <DockableDroneWorkspace
        currentDrone={{ id: 'drone-1' } as DroneSummary}
        paneHeaderMode="normal"
        activeToolTab="editor"
        openRequestNonce={0}
        chatContent={<div data-workspace-chat="1" />}
        renderToolPane={() => <div data-workspace-tool="1" />}
        previewTab="preview"
      />,
    );

    expect(html).toContain('data-workspace-chat="1"');
    expect(html).not.toContain('data-workspace-tool="1"');
    expect(html).not.toContain('aria-label="Mobile workspace panes"');
  });
});
