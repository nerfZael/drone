import { describe, expect, test } from 'bun:test';
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

  test('grows and contains overflowing controls when expanded', () => {
    const html = renderToStaticMarkup(
      <DroneWorkspaceHeaderFrame selectedHeader expanded>
        <div>Header</div>
        <div>Controls</div>
      </DroneWorkspaceHeaderFrame>,
    );

    expect(html).toContain('h-auto');
    expect(html).toContain('max-h-[46dvh]');
    expect(html).toContain('overflow-y-auto');
    expect(html).not.toContain('h-[3.25rem]');
  });
});
