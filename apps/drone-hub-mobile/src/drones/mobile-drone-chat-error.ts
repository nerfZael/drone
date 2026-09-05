const CONNECTION_STATE_ERRORS = [
  /^no paired device is connected$/i,
  /^no mesh connection is available$/i,
  /^device connection closed(?: during authentication)?$/i,
  /^mesh connection changed while the request was being signed$/i,
];

/** Connection state is already presented by the device/offline UI, not as chat content. */
export function mobileDroneChatErrorMessage(value: unknown, starting = false): string | null {
  const message = String(value ?? '').trim();
  if (!message) return null;
  if (starting && /still starting|^unknown chat:|^unknown drone:/i.test(message)) return null;
  return CONNECTION_STATE_ERRORS.some((pattern) => pattern.test(message)) ? null : message;
}

export function mobileDroneStartupMessage(phase: string): string | null {
  switch (phase.trim().toLowerCase()) {
    case 'starting':
      return 'Preparing your workspace… Your messages will send when it is ready.';
    case 'creating':
      return 'Creating your workspace… Your messages are queued.';
    case 'seeding':
      return 'Starting the agent… Your messages are queued.';
    default:
      return null;
  }
}
