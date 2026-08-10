import { InvalidRequestError } from '../domain-errors';

export function isUngroupedGroupName(value: unknown): boolean {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'ungrouped'
  );
}

export function validateGroupName(value: unknown, label = 'group'): string {
  const name = String(value ?? '').trim();
  if (!name) throw new InvalidRequestError(`invalid ${label} (must be non-empty)`);
  if (name.length > 64) throw new InvalidRequestError(`invalid ${label} (max 64 chars)`);
  if (isUngroupedGroupName(name)) {
    throw new InvalidRequestError(`invalid ${label} ("Ungrouped" is reserved)`);
  }
  return name;
}
