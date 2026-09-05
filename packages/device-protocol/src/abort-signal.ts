/** React Native signals lack the newer throwIfAborted() prototype method. */
export function throwIfAborted(
  signal?: { readonly aborted: boolean; readonly reason?: unknown } | null,
): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
}
