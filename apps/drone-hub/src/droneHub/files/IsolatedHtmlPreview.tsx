import React from 'react';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { UiButton } from '../../ui/components';
import { HTML_PREVIEW_MAX_BYTES, HTML_PREVIEW_LIMIT_MESSAGE, checkHtmlPreviewSize, HtmlPreviewTooLargeError } from './html-preview-limits';
import { LargeHtmlPreviewNotice } from './LargeHtmlPreviewNotice';
import {
  embedHtmlPreviewImages,
  readHtmlPreviewImage,
  resolveHtmlPreviewImagePath,
  htmlPreviewImageBridge,
  HTML_PREVIEW_IMAGE_REQUEST,
  HTML_PREVIEW_IMAGE_RESPONSE,
} from './html-preview-images';
import {
  buildIsolatedHtmlPreviewDocument,
  HTML_PREVIEW_IFRAME_SANDBOX,
  HTML_PREVIEW_PERMISSIONS_POLICY,
} from './html-preview-security';

// React 18's iframe types predate this Chromium attribute. Its presence gives
// the preview an ephemeral, credential-free network/storage context.
const credentiallessIframeProps = { credentialless: '' };

export function IsolatedHtmlPreview({
  source,
  fileName,
  droneId,
  filePath,
}: {
  source: string;
  fileName?: string | null;
  droneId?: string;
  filePath?: string;
}) {
  // A key is an identity, never a serialization of the document. Keep the source
  // reference only, and reset consent whenever the accepted document changes.
  const [session, setSession] = React.useState({ droneId, filePath, fileName, source, id: 0 });
  let current = session;
  if (session.droneId !== droneId || session.filePath !== filePath || session.fileName !== fileName || session.source !== source) {
    current = { droneId, filePath, fileName, source, id: session.id + 1 };
    setSession(current);
  }
  // This component also has callers which already have an in-memory source.
  const tooLarge = React.useMemo(() => source.length > HTML_PREVIEW_MAX_BYTES || new TextEncoder().encode(source).byteLength > HTML_PREVIEW_MAX_BYTES, [source]);
  if (tooLarge) return <div role="alert" className="p-3 text-12">{HTML_PREVIEW_LIMIT_MESSAGE}</div>;
  return <HtmlPreviewSession key={current.id} source={source} fileName={fileName} droneId={droneId} filePath={filePath} />;
}

function HtmlPreviewSession({ source, fileName, droneId, filePath }: { source: string; fileName?: string | null; droneId?: string; filePath?: string }) {
  const confirm = useAppConfirmDialog();
  const [allowExternalResources, setAllowExternalResources] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [imageToken] = React.useState(() => crypto.randomUUID());
  const [dynamicFailures, setDynamicFailures] = React.useState(0);
  const [imagesTooLarge, setImagesTooLarge] = React.useState(false);
  const [images, setImages] = React.useState<{ source: string; failed: number } | null>(
    droneId && filePath ? null : { source, failed: 0 },
  );
  React.useEffect(() => {
    if (!droneId || !filePath) return;
    const controller = new AbortController();
    void embedHtmlPreviewImages(source, filePath, path => readHtmlPreviewImage(droneId, path, controller.signal))
      .then(result => { if (!controller.signal.aborted) setImages(result); })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof HtmlPreviewTooLargeError) { setImagesTooLarge(true); controller.abort(); }
        else setImages({ source, failed: 1 });
      });
    return () => controller.abort();
  }, [source, droneId, filePath]);
  React.useEffect(() => {
    if (!droneId || !filePath) return;
    const controller = new AbortController();
    const reads = new Map<string, Promise<string | null>>();
    let imageBytes = new TextEncoder().encode(images?.source ?? source).byteLength;
    const receive = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow;
      const data = event.data;
      if (!frame || event.source !== frame || !data || data.type !== HTML_PREVIEW_IMAGE_REQUEST || data.token !== imageToken) return;
      if (typeof data.id !== 'string' || data.id.length > 32 || typeof data.href !== 'string' || data.href.length > 8192) return;
      const path = resolveHtmlPreviewImagePath(filePath, data.href);
      if (!path) return;
      let read = reads.get(path);
      // Bound the number of distinct image requests made by preview scripts.
      if (!read && reads.size >= 256) {
        frame.postMessage({ type: HTML_PREVIEW_IMAGE_RESPONSE, token: imageToken, id: data.id, dataUrl: null }, '*');
        return;
      }
      if (!read) {
        read = readHtmlPreviewImage(droneId, path, controller.signal).then(dataUrl => {
          imageBytes += dataUrl.length;
          checkHtmlPreviewSize(imageBytes);
          return dataUrl;
        }).catch(error => {
          if (error instanceof HtmlPreviewTooLargeError && !controller.signal.aborted) {
            setImagesTooLarge(true); controller.abort();
          }
          if (!controller.signal.aborted) setDynamicFailures(count => count + 1);
          return null;
        });
        reads.set(path, read);
      }
      void read.then(dataUrl => {
        if (!controller.signal.aborted && iframeRef.current?.contentWindow === frame) {
          frame.postMessage({ type: HTML_PREVIEW_IMAGE_RESPONSE, token: imageToken, id: data.id, dataUrl }, '*');
        }
      });
    };
    window.addEventListener('message', receive);
    return () => { controller.abort(); window.removeEventListener('message', receive); };
  }, [droneId, filePath, imageToken, allowExternalResources, images, source]);
  const document = React.useMemo(
    () => buildIsolatedHtmlPreviewDocument(
      (droneId && filePath ? htmlPreviewImageBridge(imageToken) : '') + (images?.source ?? ''),
      allowExternalResources,
    ),
    [images, allowExternalResources, droneId, filePath, imageToken],
  );

  async function enableExternalResources() {
    setConfirming(true);
    try {
      if (await confirm({
        title: 'Enable external resources?',
        message: 'This reloads the preview and lets it download and run external scripts, load other resources, and make network requests. Scripts can send this file’s contents to third parties or contact services on your local network. Only enable this for HTML you trust. Browser storage and direct access to DroneHub remain blocked. This permission lasts only for the current preview; refreshing or reopening it requires confirmation again.',
        confirmLabel: 'Enable external resources',
        cancelLabel: 'Keep isolated',
        destructive: true,
      })) setAllowExternalResources(true);
    } finally {
      setConfirming(false);
    }
  }

  if (imagesTooLarge && droneId && filePath) return <LargeHtmlPreviewNotice droneId={droneId} path={filePath} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-1.5 text-10 text-[var(--muted)]">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${allowExternalResources ? 'bg-[var(--yellow)]' : 'bg-[var(--green)]'}`}
          aria-hidden="true"
        />
        <span className="flex-1">
          {allowExternalResources
            ? 'External resources enabled: scripts and network requests can run. Storage and direct DroneHub access remain blocked.'
            : 'Isolated preview: local images and inline scripts work; external resources, network, storage, and DroneHub access are blocked.'}
        </span>
        <UiButton
          disabled={confirming}
          onClick={() => allowExternalResources ? setAllowExternalResources(false) : void enableExternalResources()}
        >
          {allowExternalResources ? 'Return to isolated preview' : 'Enable external resources'}
        </UiButton>
      </div>
      {(images?.failed ?? 0) + dynamicFailures > 0 ? <div role="status" className="shrink-0 bg-[var(--panel-alt)] px-3 py-1.5 text-10 text-[var(--muted)]">Local images could not be loaded. Check that the image files exist beside this HTML file at the referenced paths.</div> : null}
      {images ? <iframe
        ref={iframeRef}
        key={String(allowExternalResources)}
        title={`${fileName || 'HTML file'} preview`}
        sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
        allow={HTML_PREVIEW_PERMISSIONS_POLICY}
        referrerPolicy="no-referrer"
        srcDoc={document}
        {...credentiallessIframeProps}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      /> : <div role="status" className="p-3 text-12 text-[var(--muted)]">Loading local images…</div>}
    </div>
  );
}
