// Copying reads the whole file into the Hub page, unlike the preview, which
// loads it inside its own sandboxed frame.
export const HTML_COPY_MAX_BYTES = 20 * 1024 * 1024;

export class HtmlCopyTooLargeError extends Error {
  constructor() { super('Files over 20 MiB cannot be copied to the clipboard.'); }
}

export function checkHtmlCopySize(bytes: number): void {
  if (bytes > HTML_COPY_MAX_BYTES) throw new HtmlCopyTooLargeError();
}
