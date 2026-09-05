const CONNECTION_STATE_ERRORS = [
  /^no paired device is connected$/i,
  /^no mesh connection is available$/i,
  /^device connection closed(?: during authentication)?$/i,
  /^mesh connection changed while the request was being signed$/i,
];

/** Connection state is already presented by the device/offline UI, not as chat content. */
export function mobileDroneChatErrorMessage(value: unknown): string | null {
  const message = String(value ?? '').trim();
  if (!message) return null;
  return CONNECTION_STATE_ERRORS.some((pattern) => pattern.test(message)) ? null : message;
}
