import type { DroneFsEntry } from '../types';

export function sameDroneFsEntries(
  left: readonly DroneFsEntry[] | null | undefined,
  right: readonly DroneFsEntry[] | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (
      !rightEntry ||
      leftEntry.name !== rightEntry.name ||
      leftEntry.path !== rightEntry.path ||
      leftEntry.kind !== rightEntry.kind ||
      leftEntry.size !== rightEntry.size ||
      leftEntry.mtimeMs !== rightEntry.mtimeMs ||
      leftEntry.ext !== rightEntry.ext ||
      leftEntry.isGitIgnored !== rightEntry.isGitIgnored ||
      leftEntry.isImage !== rightEntry.isImage ||
      leftEntry.isVideo !== rightEntry.isVideo
    ) {
      return false;
    }
  }
  return true;
}
