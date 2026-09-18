import React from 'react';
import type { CompanionImageAttachment } from '@drone/assistant-chat';
import { UiDialog } from '../../ui/components/Dialog';
import { desktopMonacoTheme } from '../../theme';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { PortableEditorHost } from '../chat/PortableEditorHost';
import {
  DRONE_HUB_MONACO_SCROLLBAR_OPTIONS, defineDroneHubMonacoThemes, MonacoEditor, MonacoEditorErrorBoundary, type MonacoEditorProps,
} from '../files/monaco-editor-loader';
import { useCompanionWindow } from './companion-window';

export function isCompanionTextAttachment(attachment: Pick<CompanionImageAttachment, 'mime'>) {
  return attachment.mime === 'text/plain';
}

export function companionAttachmentText(attachment: Pick<CompanionImageAttachment, 'dataBase64'>) {
  return new TextDecoder().decode(Uint8Array.from(atob(attachment.dataBase64), char => char.charCodeAt(0)));
}

const MAX_ZOOM = 12;
const headerButton = 'rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40';

/** Wheel zooms around the pointer, dragging pans, double-click toggles between fit and 2×. */
function ImageViewer({ src, alt, view, setView }: {
  src: string; alt: string;
  view: { scale: number; x: number; y: number };
  setView: React.Dispatch<React.SetStateAction<{ scale: number; x: number; y: number }>>;
}) {
  const frame = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
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
    <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full object-contain"
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

function TextViewer({ text, name }: { text: string; name: string }) {
  const { detached } = useCompanionWindow();
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

export function CompanionAttachmentDialog({ attachment, onClose, portalContainer }: {
  attachment: CompanionImageAttachment; onClose(): void; portalContainer?: HTMLElement;
}) {
  const isText = isCompanionTextAttachment(attachment);
  const text = React.useMemo(() => isText ? companionAttachmentText(attachment) : '', [attachment, isText]);
  const [view, setView] = React.useState({ scale: 1, x: 0, y: 0 });
  return <UiDialog open onClose={onClose} title={attachment.name} size="large" hideHeader portalContainer={portalContainer} bodyClassName="min-h-0 !p-0">
    <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]" title={attachment.name}>
        {isText ? `Pasted text · ${text.length.toLocaleString()} characters` : attachment.name}
      </span>
      {isText ? null : <>
        <button type="button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => setView(current => zoomedView(current, 0.8, 0, 0))} className={headerButton}>−</button>
        <button type="button" aria-label="Reset zoom" title="Fit to window" onClick={() => setView({ scale: 1, x: 0, y: 0 })} className={`${headerButton} min-w-[3.5rem] tabular-nums`}>{Math.round(view.scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" disabled={view.scale >= MAX_ZOOM} onClick={() => setView(current => zoomedView(current, 1.25, 0, 0))} className={headerButton}>+</button>
      </>}
      <button type="button" aria-label="Close dialog" onClick={onClose} className={headerButton}>✕</button>
    </div>
    {isText ? <TextViewer text={text} name={attachment.name} />
      : <ImageViewer src={`data:${attachment.mime};base64,${attachment.dataBase64}`} alt={attachment.name} view={view} setView={setView} />}
  </UiDialog>;
}
