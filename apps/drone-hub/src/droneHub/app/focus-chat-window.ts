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
