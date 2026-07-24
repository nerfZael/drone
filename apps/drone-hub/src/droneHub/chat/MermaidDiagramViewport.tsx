import React from 'react';

export type MermaidSvgDimensions = {
  height: number;
  width: number;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_BUTTON_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function getMermaidSvgDimensions(svg: string): MermaidSvgDimensions {
  const viewBox = /\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
  const width = Number(viewBox?.[1]);
  const height = Number(viewBox?.[2]);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  return { width: 800, height: 420 };
}

export function clampMermaidZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function fitMermaidZoom(
  viewportWidth: number,
  viewportHeight: number,
  diagram: MermaidSvgDimensions,
): number {
  const horizontalPadding = 48;
  const verticalPadding = 48;
  const availableWidth = Math.max(1, viewportWidth - horizontalPadding);
  const availableHeight = Math.max(1, viewportHeight - verticalPadding);
  return clampMermaidZoom(
    Math.min(availableWidth / diagram.width, availableHeight / diagram.height),
  );
}

function zoomFromWheel(currentZoom: number, deltaY: number): number {
  return clampMermaidZoom(currentZoom * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY));
}

export function MermaidDiagramViewport({
  dimensions,
  fitRequest,
  onZoomChange,
  svg,
}: {
  dimensions: MermaidSvgDimensions;
  fitRequest: number;
  onZoomChange: (zoom: number) => void;
  svg: string;
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const panRef = React.useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [panning, setPanning] = React.useState(false);
  const [fitMode, setFitMode] = React.useState(true);

  const updateZoom = React.useCallback(
    (nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
      const viewport = viewportRef.current;
      const clampedZoom = clampMermaidZoom(nextZoom);
      if (!viewport || clampedZoom === zoom) return;

      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor ? anchor.clientX - rect.left : viewport.clientWidth / 2;
      const anchorY = anchor ? anchor.clientY - rect.top : viewport.clientHeight / 2;
      const contentX = viewport.scrollLeft + anchorX;
      const contentY = viewport.scrollTop + anchorY;
      const ratio = clampedZoom / zoom;

      setZoom(clampedZoom);
      onZoomChange(clampedZoom);
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * ratio - anchorX;
        viewport.scrollTop = contentY * ratio - anchorY;
      });
    },
    [onZoomChange, zoom],
  );

  const fitDiagram = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextZoom = fitMermaidZoom(viewport.clientWidth, viewport.clientHeight, dimensions);
    setZoom(nextZoom);
    setFitMode(true);
    onZoomChange(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  }, [dimensions, onZoomChange]);

  React.useLayoutEffect(() => {
    fitDiagram();
  }, [fitDiagram, fitRequest, svg]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (fitMode) fitDiagram();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitDiagram, fitMode]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setFitMode(false);
      updateZoom(zoomFromWheel(zoom, event.deltaY), {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [updateZoom, zoom]);

  return (
    <div className="dh-mermaid-card__viewport-shell" data-collapse-toggle-ignore="true">
      <div
        ref={viewportRef}
        className={`dh-mermaid-card__viewport ${panning ? 'is-panning' : ''}`}
        role="img"
        aria-label="Rendered Mermaid diagram"
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 1 && event.button !== 2) return;
          const viewport = viewportRef.current;
          if (!viewport) return;
          event.preventDefault();
          viewport.setPointerCapture(event.pointerId);
          panRef.current = {
            clientX: event.clientX,
            clientY: event.clientY,
            pointerId: event.pointerId,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          };
          setPanning(true);
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          const viewport = viewportRef.current;
          if (!pan || !viewport || pan.pointerId !== event.pointerId) return;
          viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
          viewport.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
        }}
        onPointerUp={(event) => {
          if (panRef.current?.pointerId !== event.pointerId) return;
          panRef.current = null;
          setPanning(false);
          if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
            viewportRef.current.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          panRef.current = null;
          setPanning(false);
        }}
      >
        <div className="dh-mermaid-card__canvas">
          <div
            className="dh-mermaid-card__canvas-size"
            style={{
              height: dimensions.height * zoom,
              width: dimensions.width * zoom,
            }}
          >
            <div
              className="dh-mermaid-card__surface"
              style={{
                height: dimensions.height,
                transform: `scale(${zoom})`,
                width: dimensions.width,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      </div>
      <div className="dh-mermaid-card__viewport-hint" aria-hidden="true">
        Wheel to zoom · Right-drag to pan
      </div>
      <div className="dh-mermaid-card__viewport-controls" role="group" aria-label="Diagram zoom">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => {
            setFitMode(false);
            updateZoom(zoom / ZOOM_BUTTON_FACTOR);
          }}
        >
          −
        </button>
        <button
          type="button"
          className="is-zoom-value"
          aria-label="Fit diagram to viewport"
          onClick={fitDiagram}
          title="Fit diagram to viewport"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => {
            setFitMode(false);
            updateZoom(zoom * ZOOM_BUTTON_FACTOR);
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
