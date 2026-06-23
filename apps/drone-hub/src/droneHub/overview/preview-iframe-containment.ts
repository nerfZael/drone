export const PREVIEW_IFRAME_STRICT_SANDBOX =
  'allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-scripts';

export const PREVIEW_IFRAME_STORAGE_SANDBOX = `${PREVIEW_IFRAME_STRICT_SANDBOX} allow-same-origin`;

export const PREVIEW_FOCUS_INTENT_MS = 1200;

export const NO_PREVIEW_POINTER_TIME = Number.NEGATIVE_INFINITY;

export function isPreviewFocusUserRequested(
  now: number,
  lastPreviewPointerAt: number,
  previewHovered: boolean = false,
): boolean {
  if (previewHovered) return true;
  return now >= lastPreviewPointerAt && now - lastPreviewPointerAt < PREVIEW_FOCUS_INTENT_MS;
}

export function previewIframeSandboxForUrl(rawUrl: string | null, hubOrigin: string | null): string {
  const raw = String(rawUrl ?? '').trim();
  if (!raw) return PREVIEW_IFRAME_STRICT_SANDBOX;
  if (!hubOrigin) return PREVIEW_IFRAME_STORAGE_SANDBOX;
  try {
    const parsed = new URL(raw, hubOrigin);
    return parsed.origin === hubOrigin ? PREVIEW_IFRAME_STRICT_SANDBOX : PREVIEW_IFRAME_STORAGE_SANDBOX;
  } catch {
    return PREVIEW_IFRAME_STRICT_SANDBOX;
  }
}
