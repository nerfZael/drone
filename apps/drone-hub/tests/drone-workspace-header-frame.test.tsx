import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DroneWorkspaceHeaderFrame } from '../src/droneHub/app/DroneWorkspaceHeaderFrame';

describe('DroneWorkspaceHeaderFrame', () => {
  test('keeps the compact header at its fixed single-row height', () => {
    const html = renderToStaticMarkup(
      <DroneWorkspaceHeaderFrame selectedHeader>
        <div>Header</div>
      </DroneWorkspaceHeaderFrame>,
    );

    expect(html).toContain('h-[3.25rem]');
    expect(html).not.toContain('overflow-y-auto');
  });

  test('gives the selected drone title a subtle size lift', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('dh-type-workspace-title !text-[.9375rem]');
  });
});
