import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceExplorerHeader } from '../src/droneHub/app/WorkspaceExplorerHeader';

const zoomProps = {
  zoom: 1,
  onDecreaseZoom: () => {},
  onIncreaseZoom: () => {},
  onResetZoom: () => {},
};

describe('workspace explorer header', () => {
  test('uses the Files title area as the optional drag handle', () => {
    const html = renderToStaticMarkup(
      <WorkspaceExplorerHeader
        {...zoomProps}
        dragHandle={{
          onDragStart: () => {},
          onDragEnd: () => {},
          title: 'Drag to move the File Explorer to the other side',
        }}
      />,
    );

    expect(html).toContain('draggable="true"');
    expect(html).toContain('cursor-grab');
    expect(html).toContain('Drag to move the File Explorer to the other side');
    expect(html.match(/<button/g)?.length).toBe(3);
    expect(html).not.toContain('Move File Explorer');
  });

  test('leaves shared non-editor explorer headers stationary', () => {
    const html = renderToStaticMarkup(<WorkspaceExplorerHeader {...zoomProps} />);

    expect(html).toContain('draggable="false"');
    expect(html).not.toContain('cursor-grab');
  });
});
