export type MobileRecordingPermission = {
  granted: boolean;
  canAskAgain?: boolean;
};

export async function ensureMobileRecordingPermission({
  getPermission,
  requestPermission,
}: {
  getPermission(): Promise<MobileRecordingPermission>;
  requestPermission(): Promise<MobileRecordingPermission>;
}): Promise<MobileRecordingPermission> {
  const current = await getPermission();
  if (current.granted || current.canAskAgain === false) return current;
  return await requestPermission();
}

export async function ensureMobileBackgroundRecordingPermission({
  platform,
  platformVersion,
  requestPermission,
}: {
  platform: string;
  platformVersion: number;
  requestPermission(): Promise<MobileRecordingPermission>;
}): Promise<void> {
  if (platform !== 'android' || platformVersion < 33) return;
  const permission = await requestPermission();
  if (permission.granted) return;
  throw new Error(
    permission.canAskAgain === false
      ? 'Notification permission is disabled. Enable it in the phone’s system settings to listen while the screen is locked.'
      : 'Notification permission is required to keep listening while the screen is locked.',
  );
}
