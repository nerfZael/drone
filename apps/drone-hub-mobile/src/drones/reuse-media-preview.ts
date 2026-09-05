import type { MobileFilePreview } from './file-preview-model';

/** Only reuse bytes after a fresh authorized response confirms the same revision. */
export function canReuseMobileMediaPreview(
  preview: MobileFilePreview,
  metadata: Partial<MobileFilePreview> | null | undefined,
  fileExists: boolean,
): boolean {
  if (!metadata) return false;
  return Boolean(
    preview.revision &&
    preview.revision === metadata?.revision &&
    (preview.kind === 'image' || preview.kind === 'video') &&
    preview.path === metadata.path &&
    preview.kind === metadata.kind &&
    preview.mime === metadata.mime &&
    preview.size === metadata.size &&
    preview.mtimeMs === metadata.mtimeMs &&
    (fileExists || (preview.mime === 'image/svg+xml' && typeof preview.content === 'string')),
  );
}
