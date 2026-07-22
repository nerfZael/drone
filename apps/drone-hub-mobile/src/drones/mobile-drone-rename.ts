export function validateMobileDroneRename(
  nameRaw: string,
  currentNameRaw: string,
): string | null {
  const name = String(nameRaw ?? '').trim();
  const currentName = String(currentNameRaw ?? '').trim();
  if (!name) return 'Enter a drone name.';
  if (/[\r\n]/.test(name)) return 'Drone names cannot contain newlines.';
  if (name.length > 80) return 'Drone names must be 80 characters or fewer.';
  if (name === currentName) return 'Enter a different name.';
  return null;
}

export function mobileDroneRenameErrorMessage(errorRaw: unknown): string {
  const error = String((errorRaw as any)?.message ?? errorRaw ?? '').trim();
  if (!error) return 'Rename failed. Try again.';
  if (/already exists/i.test(error)) return 'A drone with that name already exists.';
  if (/still starting/i.test(error)) return 'This drone is still starting. Try again in a moment.';
  if (/not granted|not permitted|permission/i.test(error)) {
    return 'This phone does not have permission to rename drones on that device.';
  }
  return error;
}
