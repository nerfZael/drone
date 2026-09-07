import React from 'react';
import { beginDesktopWorkspaceLoad, desktopWorkspaceLoads } from '../files/workspace-load-telemetry';

/** Image readiness is independent of transcript readiness, including lazy images. */
export function TrackedChatImage({ droneId, onLoad, onError, ...props }:
  React.ImgHTMLAttributes<HTMLImageElement> & { droneId?: string }) {
  const element = React.useRef<HTMLImageElement | null>(null);
  const span = React.useRef<string>();
  const resourceWindow = React.useRef({ src: props.src, started: performance.now() });
  if (resourceWindow.current.src !== props.src) resourceWindow.current = { src: props.src, started: performance.now() };
  const finish = React.useCallback((error = false) => {
    if (!span.current) return;
    const img = element.current;
    const entries = img ? performance.getEntriesByName(img.currentSrc || img.src)
      .filter((entry) => entry.startTime >= resourceWindow.current.started) : [];
    const resource = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
    if (resource) {
      desktopWorkspaceLoads.mark(span.current, 'resourceDurationMs', resource.duration);
      desktopWorkspaceLoads.mark(span.current, 'responseBytes', resource.encodedBodySize);
    }
    if (error) desktopWorkspaceLoads.finish(span.current, 'error');
    else {
      desktopWorkspaceLoads.mark(span.current, 'imageDecoded');
      desktopWorkspaceLoads.committed(span.current);
    }
  }, []);
  React.useEffect(() => {
    const img = element.current;
    if (!img || !droneId || !props.src) return;
    const begin = () => {
      if (span.current) return;
      span.current = beginDesktopWorkspaceLoad('media-load', droneId, props.src!);
      desktopWorkspaceLoads.mark(span.current, 'visible');
      if (img.complete) {
        desktopWorkspaceLoads.mark(span.current, 'alreadyLoaded', 1);
        finish(img.naturalWidth === 0);
      }
    };
    // Do not report offscreen lazy images as timed-out user interactions.
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) begin(); })
      : null;
    if (observer) observer.observe(img);
    else begin();
    return () => {
      observer?.disconnect();
      desktopWorkspaceLoads.finish(span.current, 'superseded');
      span.current = undefined;
    };
  }, [droneId, props.src, finish]);
  return <img {...props} ref={element} decoding="async"
    onLoad={(event) => { finish(); onLoad?.(event); }}
    onError={(event) => { finish(true); onError?.(event); }} />;
}
