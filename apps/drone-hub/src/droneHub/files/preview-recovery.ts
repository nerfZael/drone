const STORAGE_KEY = 'droneHub.previewRecoveryFiles';

function recoveredFiles(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string').slice(-500) : [];
  } catch { return []; }
}

export function rememberPreviewRecovery(fileKey: string, sourceOnly: boolean): void {
  try {
    const keys = recoveredFiles().filter(key => key !== fileKey);
    if (sourceOnly) keys.push(fileKey);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-500)));
  } catch { /* Recovery still works for this session if storage is unavailable. */ }
}

export function shouldRecoverPreviewAsSource(fileKey: string): boolean {
  const recovering = new URLSearchParams(window.location.search).get('droneRecovery') === 'source';
  if (recovering) rememberPreviewRecovery(fileKey, true);
  return recovering || recoveredFiles().includes(fileKey);
}
