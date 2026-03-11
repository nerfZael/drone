export function isTransientDroneStartupError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '')
    .trim()
    .toLowerCase();
  return (
    message.includes('still starting') ||
    message.includes('still provisioning') ||
    message.includes('starting host runtime')
  );
}
