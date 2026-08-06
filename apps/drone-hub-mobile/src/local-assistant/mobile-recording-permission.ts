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
