import React from 'react';

type VideoPreviewProps = {
  src: string;
  label: string;
  mime?: string | null;
  className?: string;
  loadingClassName?: string;
  onError?: () => void;
};

function videoMimeFromSrc(src: string, fallback?: string | null): string | undefined {
  const explicit = String(fallback ?? '').trim();
  if (explicit.startsWith('video/')) return explicit;
  const pathOnly = String(src ?? '').split('?')[0].split('#')[0].toLowerCase();
  if (pathOnly.endsWith('.webm')) return 'video/webm';
  if (pathOnly.endsWith('.mp4') || pathOnly.endsWith('.m4v')) return 'video/mp4';
  if (pathOnly.endsWith('.mov')) return 'video/quicktime';
  if (pathOnly.endsWith('.ogv') || pathOnly.endsWith('.ogg')) return 'video/ogg';
  return undefined;
}

function shouldFetchAsBlob(src: string): boolean {
  return String(src ?? '').startsWith('/api/');
}

export function VideoPreview({
  src,
  label,
  mime,
  className,
  loadingClassName,
  onError,
}: VideoPreviewProps) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const onErrorRef = React.useRef(onError);
  const sourceType = videoMimeFromSrc(src, mime);

  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  React.useEffect(() => {
    setBlobUrl(null);
    setFailed(false);
    if (!src || !shouldFetchAsBlob(src)) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true);
    fetch(src, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`video request failed (${response.status})`);
        return await response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFailed(true);
        onErrorRef.current?.();
        console.warn('[DroneHub] Video preview failed', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const effectiveSrc = shouldFetchAsBlob(src) ? blobUrl : src;
  if (failed) {
    return (
      <div className={loadingClassName ?? 'min-h-[120px] flex items-center justify-center text-[var(--text-11)] text-[var(--muted)] px-3 text-center'}>
        Failed to load video.
      </div>
    );
  }
  if (!effectiveSrc || loading) {
    return (
      <div className={loadingClassName ?? 'min-h-[120px] flex items-center justify-center text-[var(--text-11)] text-[var(--muted)] px-3 text-center'}>
        Loading video...
      </div>
    );
  }

  return (
    <video
      key={effectiveSrc}
      controls
      playsInline
      preload="metadata"
      className={className}
      aria-label={label}
      onError={() => {
        setFailed(true);
        onErrorRef.current?.();
      }}
    >
      <source src={effectiveSrc} type={sourceType} />
    </video>
  );
}
