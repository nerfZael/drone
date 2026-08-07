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
  // Android does not require POST_NOTIFICATIONS to start a foreground
  // service. Ask so the recording controls can be visible in the notification
  // drawer, but keep lock-screen capture available if the user declines.
  await requestPermission();
}
