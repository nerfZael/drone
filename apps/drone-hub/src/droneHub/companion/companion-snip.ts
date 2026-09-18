/** Screen capture needs the desktop app; a browser-only Hub does not offer it. */
export function canSnipForCompanion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.droneHubDesktop?.captureCompanion);
}

/** The same path the capture shortcuts take: Companion attaches the result to the next instruction. */
export function snipForCompanion(mode: 'region' | 'screen'): void {
  window.dispatchEvent(new CustomEvent('companion-capture', { detail: mode }));
}
