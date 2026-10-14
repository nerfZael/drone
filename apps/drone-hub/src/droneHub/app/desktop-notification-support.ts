export async function desktopNotificationSupport(): Promise<'cards' | 'outdated' | 'browser'> {
  const desktop = window.droneHubDesktop;
  if (!desktop) return 'browser';
  // Ask the running main process: a renderer reload may pick up a new preload
  // while the old main process is still using OS notifications.
  if (!desktop.notificationDisplay || !desktop.showNotification) return 'outdated';
  try {
    return await desktop.notificationDisplay() === 'cards' ? 'cards' : 'outdated';
  } catch {
    return 'outdated';
  }
}
