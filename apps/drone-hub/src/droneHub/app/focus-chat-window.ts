// Dockview mounts content through a portal; the composer can arrive even later.
// Claim the chat scope first so shortcuts target it during loading, then focus
// its composer unless the user has already moved focus elsewhere.
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
    const composer = scope.querySelector<HTMLElement>('textarea:not(:disabled), [contenteditable="true"]');
    if (composer) {
      composer.focus();
      cancel();
    } else {
      scope.tabIndex = -1;
      scope.focus();
    }
  };
  const observer = new MutationObserver(() => {
    if (!cancelled && frame === null) frame = requestAnimationFrame(tryFocus);
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('pointerdown', onInteraction, true);
  document.addEventListener('focusin', onInteraction, true);
  frame = requestAnimationFrame(tryFocus);
  return cancel;
}
