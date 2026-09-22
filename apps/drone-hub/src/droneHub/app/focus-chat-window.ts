// Long enough to outlive the render that follows a selection; short enough
// that a selection which changed nothing cannot hold back the next one.
const KEEP_FOCUS_TTL_MS = 1_000;
let keepFocusUntil = 0;

/**
 * The next chat activation must leave keyboard focus where it is. A canvas
 * opens the chat behind a clicked card, and its selection still has copy,
 * paste and delete to answer to.
 */
export function keepFocusOnNextChatActivation(now: number = Date.now()): void {
  keepFocusUntil = now + KEEP_FOCUS_TTL_MS;
}

/** True once per marked activation, and never for an old mark. */
export function consumeKeepFocusOnChatActivation(now: number = Date.now()): boolean {
  const keep = keepFocusUntil > now;
  keepFocusUntil = 0;
  return keep;
}

// Dockview mounts content through a portal. Focus the chat scope when it
// arrives so shortcuts target it without typing into the composer.
export function focusChatWindow(
  root: HTMLElement,
  findScope: () => HTMLElement | null | undefined,
  isAvailable: () => boolean,
): () => void {
  let frame: number | null = null;
  let scope: HTMLElement | null = null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('pointerdown', onInteraction, true);
    document.removeEventListener('focusin', onInteraction, true);
  };
  const onInteraction = (event: Event) => {
    if (!scope?.contains(event.target as Node)) cancel();
  };
  const tryFocus = () => {
    frame = null;
    if (cancelled) return;
    if (!root.isConnected || !isAvailable()) { cancel(); return; }
    if (scope && (!scope.isConnected || document.activeElement !== scope)) { cancel(); return; }
    scope = findScope() ?? null;
    if (!scope) return;
    scope.tabIndex = -1;
    scope.focus();
    cancel();
  };
  const observer = new MutationObserver(() => {
    if (!cancelled && frame === null) frame = requestAnimationFrame(tryFocus);
  });
  observer.observe(root, { childList: true, subtree: true });
  document.addEventListener('pointerdown', onInteraction, true);
  document.addEventListener('focusin', onInteraction, true);
  frame = requestAnimationFrame(tryFocus);
  return cancel;
}
