function transferFileKey(file: unknown): string {
  const value = file && typeof file === 'object' ? (file as Record<string, unknown>) : {};
  return `${String(value.sourcePath ?? '')}\0${String(value.destinationPath ?? '')}`;
}

export function mergeWorkspaceTransferProgress(previous: unknown, incoming: unknown): unknown {
  const current =
    previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const next = incoming && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {};
  if (
    current.type !== 'workspace_transfer' ||
    next.type !== 'workspace_transfer' ||
    next.filesPartial !== true ||
    !Array.isArray(current.files) ||
    !Array.isArray(next.files)
  )
    return incoming;

  const files = [...current.files];
  const indexes = new Map(files.map((file, index) => [transferFileKey(file), index]));
  for (const file of next.files) {
    const key = transferFileKey(file);
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, files.length);
      files.push(file);
    } else {
      files[index] = file;
    }
  }
  return { ...current, ...next, filesPartial: false, files };
}
