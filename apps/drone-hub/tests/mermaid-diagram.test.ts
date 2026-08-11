import { describe, expect, test } from 'bun:test';
import {
  clampMermaidZoom,
  fitMermaidZoom,
  getMermaidCanvasDimensions,
  getMermaidSvgDimensions,
  getMermaidZoomScrollPosition,
  isMermaidZoomWheelGesture,
} from '../src/droneHub/chat/MermaidDiagramViewport';
import {
  getCachedMermaidRender,
  renderMermaidSource,
  scopeMermaidSvgIds,
} from '../src/droneHub/chat/mermaid-renderer';

describe('desktop Mermaid diagrams', () => {
  test('reads diagram dimensions from the SVG viewBox', () => {
    expect(getMermaidSvgDimensions('<svg viewBox="-10 -20 640.5 320.25"></svg>')).toEqual({
      width: 640.5,
      height: 320.25,
    });
  });

  test('fits diagrams within the viewport and keeps zoom bounded', () => {
    expect(fitMermaidZoom(848, 448, { width: 800, height: 400 })).toBe(1);
    expect(clampMermaidZoom(0.01)).toBe(0.2);
    expect(clampMermaidZoom(20)).toBe(5);
  });

  test('keeps the entire zoomed diagram inside the pannable canvas', () => {
    expect(getMermaidCanvasDimensions({ width: 800, height: 400 }, 2)).toEqual({
      width: 1_648,
      height: 848,
    });
  });

  test('only zooms diagrams for Ctrl or Command wheel gestures', () => {
    expect(isMermaidZoomWheelGesture({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(isMermaidZoomWheelGesture({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isMermaidZoomWheelGesture({ ctrlKey: false, metaKey: true })).toBe(true);
  });

  test('keeps the cursor anchored while a centered diagram grows during zoom', () => {
    expect(
      getMermaidZoomScrollPosition({
        anchorX: 500,
        anchorY: 300,
        currentZoom: 1,
        diagram: { width: 500, height: 300 },
        nextZoom: 2,
        scrollLeft: 0,
        scrollTop: 0,
        viewportHeight: 600,
        viewportWidth: 1_000,
      }),
    ).toEqual({ scrollLeft: 24, scrollTop: 24 });
  });

  test('scopes cached SVG ids for each mounted diagram', () => {
    const svg =
      '<svg id="chart"><style>#chart .node{fill:red}#chart{color:red}#fff{fill:#fff}</style><defs><marker id="arrow"></marker></defs><path marker-end="url(#arrow)" aria-labelledby="title desc"/><title id="title">Flow</title><desc id="desc">A to B</desc><g id="fff"/></svg>';
    const scoped = scopeMermaidSvgIds(svg, 'instance-7');

    expect(scoped).toContain('id="instance-7-chart"');
    expect(scoped).toContain('#instance-7-chart .node');
    expect(scoped).toContain('#instance-7-chart{color:red}');
    expect(scoped).toContain('#instance-7-fff{fill:#fff}');
    expect(scoped).toContain('url(#instance-7-arrow)');
    expect(scoped).toContain('aria-labelledby="instance-7-title instance-7-desc"');
  });

  test('keeps completed render results available across remounts', async () => {
    const oversized = `flowchart LR\n${'A --> B\n'.repeat(6_500)}`;
    const rendered = await renderMermaidSource(oversized);

    expect(rendered.errorMessage).toContain('too large');
    expect(getCachedMermaidRender(oversized)).toBe(rendered);
  });
});
