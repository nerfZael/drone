import React from 'react';
import { UiDialog } from '../../ui/components/Dialog';
import { desktopMonacoTheme } from '../../theme';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { PortableEditorHost } from '../chat/PortableEditorHost';
import {
  DRONE_HUB_MONACO_SCROLLBAR_OPTIONS, defineDroneHubMonacoThemes, MonacoEditor, MonacoEditorErrorBoundary, type MonacoEditorProps,
} from '../files/monaco-editor-loader';

/** Something to look at in full: an image by URL, or text given directly or fetched when the viewer opens. */
export type ViewedAttachment =
  | { kind: 'image'; name: string; src: string; fallbackSrcs?: string[] }
  | { kind: 'text'; name: string; text?: string; loadText?: () => Promise<string> };

const MAX_ZOOM = 12;
const headerButton = 'rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40';

/** Wheel zooms around the pointer, dragging pans, double-click toggles between fit and 2×. */
function ImageViewer({ src, fallbackSrcs = [], alt, view, setView }: {
  src: string; fallbackSrcs?: string[]; alt: string;
  view: { scale: number; x: number; y: number };
  setView: React.Dispatch<React.SetStateAction<{ scale: number; x: number; y: number }>>;
}) {
  const frame = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const [failed, setFailed] = React.useState(0);
  const zoomAt = React.useCallback((factor: number, clientX: number, clientY: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    // Offsets are measured from the frame centre, which is also the transform origin.
    const px = clientX - rect.left - rect.width / 2, py = clientY - rect.top - rect.height / 2;
    setView(current => zoomedView(current, factor, px, py));
  }, [setView]);
  React.useEffect(() => {
    const element = frame.current;
    if (!element) return;
    // React registers wheel listeners as passive, which cannot stop the dialog from scrolling.
    const onWheel = (event: WheelEvent) => { event.preventDefault(); zoomAt(Math.exp(-event.deltaY / 600), event.clientX, event.clientY); };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt]);
  return <div ref={frame} aria-label="Image viewer; scroll to zoom, drag to pan" tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { pointerX: event.clientX, pointerY: event.clientY, x: view.x, y: view.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start) setView(current => ({ ...current, x: start.x + event.clientX - start.pointerX, y: start.y + event.clientY - start.pointerY }));
    }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onDoubleClick={event => view.scale > 1 ? setView({ scale: 1, x: 0, y: 0 }) : zoomAt(2, event.clientX, event.clientY)}
    onKeyDown={event => {
      if (event.key === '+' || event.key === '=') setView(current => zoomedView(current, 1.25, 0, 0));
      else if (event.key === '-') setView(current => zoomedView(current, 0.8, 0, 0));
      else if (event.key === '0') setView({ scale: 1, x: 0, y: 0 });
    }}
    className={`flex h-[70vh] max-h-[calc(100dvh-8rem)] touch-none select-none items-center justify-center overflow-hidden bg-[var(--surface-inset-faint)] outline-none ${view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}>
    <img src={[src, ...fallbackSrcs][failed] ?? src} alt={alt} draggable={false} onError={() => setFailed(count => Math.min(count + 1, fallbackSrcs.length))} className="max-h-full max-w-full object-contain"
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, imageRendering: view.scale >= 3 ? 'pixelated' : undefined }} />
  </div>;
}

/** Scale about a point given relative to the frame centre, so that point stays under the pointer. */
export function zoomedView(view: { scale: number; x: number; y: number }, factor: number, px: number, py: number) {
  const scale = Math.max(1, Math.min(MAX_ZOOM, view.scale * factor));
  if (scale === 1) return { scale, x: 0, y: 0 };
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

function TextViewer({ text, name, detached }: { text: string; name: string; detached: boolean }) {
  const themeId = useDroneHubUiStore(state => state.themeId);
  const fallback = <pre className="dh-agent-activity-scrollbar h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-[var(--fg-secondary)]">{text}</pre>;
  const options = React.useMemo<MonacoEditorProps['options']>(() => ({
    readOnly: true, domReadOnly: true, fontSize: 12, minimap: { enabled: false }, scrollbar: DRONE_HUB_MONACO_SCROLLBAR_OPTIONS,
    wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 12, bottom: 12 }, renderLineHighlight: 'none',
    unicodeHighlight: { nonBasicASCII: false, ambiguousCharacters: false, invisibleCharacters: true },
    // Native EditContext belongs to the creating JS window and cannot follow the floating one.
    ...(detached ? { editContext: false } : {}),
  }), [detached]);
  const editor = <div aria-label={`Contents of ${name}`} className="h-[70vh] max-h-[calc(100dvh-8rem)] w-full">
    <MonacoEditorErrorBoundary fallback={fallback}>
      <React.Suspense fallback={fallback}>
        <MonacoEditor language="plaintext" value={text} loading={fallback} beforeMount={defineDroneHubMonacoThemes}
          theme={desktopMonacoTheme(themeId).id} options={options} />
      </React.Suspense>
    </MonacoEditorErrorBoundary>
  </div>;
  return detached ? <PortableEditorHost>{editor}</PortableEditorHost> : editor;
}


/**
 * The full-size view of an attachment, shared by Companion and the drone chats: text in a read-only
 * Monaco editor, images with zoom and pan. Pass the portal container of the window the click came
 * from; in a separate window Monaco needs its portable host.
 */
export function AttachmentViewerDialog({ attachment, onClose, portalContainer }: {
  attachment: ViewedAttachment; onClose(): void; portalContainer?: HTMLElement;
}) {
  const detached = Boolean(portalContainer && portalContainer.ownerDocument !== document);
  const [view, setView] = React.useState({ scale: 1, x: 0, y: 0 });
  const [loaded, setLoaded] = React.useState<{ text: string | null; error: string | null }>({ text: null, error: null });
  const loadText = attachment.kind === 'text' ? attachment.loadText : undefined;
  React.useEffect(() => {
    if (!loadText) return;
    let cancelled = false;
    loadText().then(text => { if (!cancelled) setLoaded({ text, error: null }); }, error => { if (!cancelled) setLoaded({ text: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, [loadText]);
  const text = attachment.kind === 'text' ? attachment.text ?? loaded.text : null;
  return <UiDialog open onClose={onClose} title={attachment.name} size="large" hideHeader portalContainer={portalContainer} bodyClassName="min-h-0 !p-0">
    <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]" title={attachment.name}>
        {attachment.name}{text != null ? ` · ${text.length.toLocaleString()} characters` : ''}
      </span>
      {attachment.kind === 'image' ? <>
        <button type="button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => setView(current => zoomedView(current, 0.8, 0, 0))} className={headerButton}>−</button>
        <button type="button" aria-label="Reset zoom" title="Fit to window" onClick={() => setView({ scale: 1, x: 0, y: 0 })} className={`${headerButton} min-w-[3.5rem] tabular-nums`}>{Math.round(view.scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={view.scale >= MAX_ZOOM} onClick={() => setView(current => zoomedView(current, 1.25, 0, 0))} className={headerButton}>+</button>
      </> : null}
      <button type="button" aria-label="Close dialog" onClick={onClose} className={headerButton}>✕</button>
    </div>
    {attachment.kind === 'image' ? <ImageViewer src={attachment.src} fallbackSrcs={attachment.fallbackSrcs} alt={attachment.name} view={view} setView={setView} />
      : text != null ? <TextViewer text={text} name={attachment.name} detached={detached} />
      : <div role={loaded.error ? 'alert' : 'status'} className={`flex h-40 items-center justify-center px-6 text-center text-sm ${loaded.error ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}>{loaded.error ?? 'Loading…'}</div>}
  </UiDialog>;
}

/** Dialogs open in the window the click came from: the main one, or a floating or detached one. */
export function portalContainerOf(element: Element | null): HTMLElement | undefined {
  const body = element?.ownerDocument?.body;
  return body && body.ownerDocument !== document ? body : undefined;
}
