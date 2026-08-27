export const MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY =
  'droneHubMobile.expandedSidebarFolderIds';
export const MOBILE_SIDEBAR_COLLAPSED_DRONE_IDS_STORAGE_KEY =
  'droneHubMobile.collapsedSidebarDroneIds';

function parseStoredIdSet(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const id = value.trim();
        return id ? [id] : [];
      }),
    );
  } catch {
    return new Set();
  }
}

function serializeIdSet(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

export function parseMobileSidebarExpandedFolderIds(raw: string | null): Set<string> {
  return parseStoredIdSet(raw);
}

export function serializeMobileSidebarExpandedFolderIds(
  folderIds: ReadonlySet<string>,
): string {
  return serializeIdSet(folderIds);
}

export function rewriteMobileSidebarExpandedFolderPrefix(
  folderIds: ReadonlySet<string>,
  currentPrefixRaw: string,
  nextPrefixRaw: string,
): Set<string> {
  const currentPrefix = String(currentPrefixRaw ?? '').trim();
  const nextPrefix = String(nextPrefixRaw ?? '').trim();
  if (!currentPrefix || !nextPrefix || currentPrefix === nextPrefix) {
    return new Set(folderIds);
  }
  return new Set([...folderIds].map((folderId) =>
    folderId === currentPrefix || folderId.startsWith(`${currentPrefix}/`)
      ? `${nextPrefix}${folderId.slice(currentPrefix.length)}`
      : folderId));
}

export function parseMobileSidebarCollapsedDroneIds(raw: string | null): Set<string> {
  return parseStoredIdSet(raw);
}

export function serializeMobileSidebarCollapsedDroneIds(
  droneIds: ReadonlySet<string>,
): string {
  return serializeIdSet(droneIds);
}
