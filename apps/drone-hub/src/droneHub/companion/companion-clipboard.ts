const MAX_CLIPBOARD_CHARACTERS = 100_000;

/** Companion's set_clipboard tool: replace the user's clipboard text. It never reads the clipboard. */
export async function setCompanionClipboard(value: unknown): Promise<{ copied: true; characters: number }> {
  if (typeof value !== 'string' || !value) throw new Error('CLIPBOARD_TEXT_REQUIRED');
  if (value.length > MAX_CLIPBOARD_CHARACTERS) throw new Error(`CLIPBOARD_TEXT_TOO_LONG: at most ${MAX_CLIPBOARD_CHARACTERS} characters`);
  const desktop = window.droneHubDesktop?.writeClipboardText;
  // The desktop app writes natively, because Companion usually floats over another application and
  // browsers refuse clipboard writes from a document that is not focused.
  if (desktop) await desktop(value);
  else {
    try { await navigator.clipboard.writeText(value); }
    catch { throw new Error('CLIPBOARD_UNAVAILABLE: the browser only allows this while the Drone Hub tab is focused'); }
  }
  return { copied: true, characters: value.length };
}
