export const MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY =
  'droneHubMobile.expandedSidebarFolderIds';

export function parseMobileSidebarExpandedFolderIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const folderId = value.trim();
        return folderId ? [folderId] : [];
      }),
    );
  } catch {
    return new Set();
  }
}

export function serializeMobileSidebarExpandedFolderIds(
  folderIds: ReadonlySet<string>,
): string {
  return JSON.stringify([...folderIds].sort());
}
