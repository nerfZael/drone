export type DroneRenameTarget = {
  id: string;
  currentName: string;
  error: string | null;
};

export function validateDroneRename(
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

export function droneRenameErrorMessage(errorRaw: string): string {
  const error = String(errorRaw ?? '').trim();
  if (!error) return 'Rename failed. Try again.';
  if (error === 'name already exists') return 'A drone with that name already exists.';
  if (error === 'rename busy') return 'This drone is already being updated.';
  if (error === 'invalid new name') return 'Enter a valid name using 80 characters or fewer.';
  if (/still starting/i.test(error)) return 'This drone is still starting. Try again in a moment.';
  return error;
}
