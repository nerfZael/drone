// Inline previews retain source strings, parsed markup and decoded media in the
// Hub renderer. Larger documents need a separate renderer, not a larger heap.
export const HTML_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
export const HTML_PREVIEW_LIMIT_MESSAGE = 'This file or its images exceed the embedded preview limit (20 MiB total; 5 MiB per local image). Use Source to read it without loading the entire document.';

export class HtmlPreviewTooLargeError extends Error {
  constructor() { super(HTML_PREVIEW_LIMIT_MESSAGE); }
}

export function checkHtmlPreviewSize(bytes: number): void {
  if (bytes > HTML_PREVIEW_MAX_BYTES) throw new HtmlPreviewTooLargeError();
}
