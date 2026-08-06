function errorMessage(error: unknown): string {
  return String((error as any)?.message ?? error ?? '').trim();
}

export function isTransientDroneStartupError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('still starting') ||
    message.includes('still provisioning') ||
    message.includes('starting host runtime')
  );
}

export function isTransientChatFetchError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message === 'failed to fetch' ||
    message === 'fetch failed' ||
    message === 'load failed' ||
    message.includes('networkerror when attempting to fetch resource')
  );
}

export function formatDroneRuntimeError(error: unknown): string {
  const raw = errorMessage(error);
  if (!raw) return 'Unknown drone runtime error.';

  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (/spawn\s+tmux\b.*\benoent\b/i.test(normalized)) {
    return `Host runtime sessions require tmux on the host PATH. (${normalized})`;
  }
  if (/require\s+tmux\s+on\s+the\s+host\s+path/i.test(normalized)) {
    return normalized.endsWith('.') ? normalized : `${normalized}.`;
  }
  return raw;
}
