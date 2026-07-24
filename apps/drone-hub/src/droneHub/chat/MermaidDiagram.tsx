import React from 'react';
import { createPortal } from 'react-dom';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { MermaidDiagramViewport, getMermaidSvgDimensions } from './MermaidDiagramViewport';
import {
  getCachedMermaidRender,
  renderMermaidSource,
  scopeMermaidSvgIds,
  type MermaidRenderResult,
} from './mermaid-renderer';

function MaximizeIcon({ restore }: { restore: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {restore ? (
        <path
          d="M6 2v4H2M10 14v-4h4M2 6l4-4M14 10l-4 4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = React.useId();
  const svgScope = React.useMemo(
    () => `drone-hub-mermaid-instance-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  );
  const initialRender = React.useMemo(
    () => getCachedMermaidRender(source) ?? { errorMessage: '', svg: '' },
    [source],
  );
  const [render, setRender] = React.useState<MermaidRenderResult>(initialRender);
  const [renderedSource, setRenderedSource] = React.useState(
    initialRender.svg || initialRender.errorMessage ? source : '',
  );
  const [showSource, setShowSource] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [fitRequest, setFitRequest] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const cardRef = React.useRef<HTMLElement | null>(null);
  const maximizeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const activeRenderRef = React.useRef(0);

  React.useEffect(() => {
    const cached = getCachedMermaidRender(source);
    if (cached) {
      setRender(cached);
      setRenderedSource(source);
      return;
    }

    const request = ++activeRenderRef.current;
    void renderMermaidSource(source).then((result) => {
      if (activeRenderRef.current !== request) return;
      setRender(result);
      setRenderedSource(source);
    });
    return () => {
      activeRenderRef.current += 1;
    };
  }, [source]);

  React.useEffect(() => {
    if (!maximized) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => maximizeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => maximizeButtonRef.current?.focus());
    };
  }, [maximized]);

  React.useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMaximized(false);
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = focusableElements(cardRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!cardRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized]);

  const currentRender = renderedSource === source;
  const errorMessage = currentRender ? render.errorMessage : '';
  const sourceVisible = showSource || Boolean(errorMessage);
  const dimensions = React.useMemo(() => getMermaidSvgDimensions(render.svg), [render.svg]);
  const scopedSvg = React.useMemo(
    () => scopeMermaidSvgIds(render.svg, svgScope),
    [render.svg, svgScope],
  );

  const card = (
    <section
      ref={cardRef}
      data-markdown-code-block={true}
      className={maximized ? 'dh-mermaid-card is-maximized' : 'dh-mermaid-card'}
      aria-label="Mermaid diagram"
      aria-modal={maximized || undefined}
      aria-busy={!currentRender || undefined}
      role={maximized ? 'dialog' : undefined}
    >
      <div className="dh-mermaid-card__toolbar">
        <div className="dh-mermaid-card__identity">
          <span className="dh-mermaid-card__label">Diagram</span>
          {!sourceVisible && render.svg ? (
            <span className="dh-mermaid-card__zoom-label">{Math.round(zoom * 100)}%</span>
          ) : null}
          {!currentRender && render.svg ? (
            <span className="dh-mermaid-card__render-status">Updating…</span>
          ) : null}
        </div>
        <div className="dh-mermaid-card__toolbar-actions">
          {!sourceVisible && render.svg ? (
            <button
              type="button"
              className="dh-mermaid-card__toolbar-button"
              onClick={() => setFitRequest((request) => request + 1)}
              title="Fit diagram to viewport"
            >
              Fit
            </button>
          ) : null}
          <button
            ref={maximizeButtonRef}
            type="button"
            className="dh-mermaid-card__toolbar-button"
            aria-label={maximized ? 'Restore diagram' : 'Maximize diagram'}
            onClick={() => setMaximized((value) => !value)}
            title={maximized ? 'Restore diagram' : 'Maximize diagram'}
          >
            <MaximizeIcon restore={maximized} />
            <span>{maximized ? 'Restore' : 'Maximize'}</span>
          </button>
          {errorMessage ? null : (
            <button
              type="button"
              className="dh-mermaid-card__toolbar-button"
              aria-label={sourceVisible ? 'Show rendered diagram' : 'Show Mermaid source'}
              onClick={() => setShowSource((visible) => !visible)}
            >
              {sourceVisible ? 'Diagram' : 'Source'}
            </button>
          )}
        </div>
      </div>
      {sourceVisible ? (
        <div className="dh-mermaid-card__source">
          <ChatMessageCopyAction text={source} position="code" copyLabel="diagram source" />
          {errorMessage ? (
            <div className="dh-mermaid-card__error" role="alert">
              {errorMessage}
            </div>
          ) : null}
          <pre>
            <code className="language-mermaid">{source}</code>
          </pre>
        </div>
      ) : render.svg ? (
        <MermaidDiagramViewport
          dimensions={dimensions}
          fitRequest={fitRequest}
          onZoomChange={setZoom}
          svg={scopedSvg}
        />
      ) : (
        <div className="dh-mermaid-card__loading" role="status">
          Rendering diagram…
        </div>
      )}
    </section>
  );

  if (!maximized || typeof document === 'undefined') return card;
  return createPortal(
    <div
      className="dh-mermaid-card__overlay"
      onMouseDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget) setMaximized(false);
      }}
    >
      {card}
    </div>,
    document.body,
  );
}
