import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY,
  parseMobileSidebarExpandedFolderIds,
  serializeMobileSidebarExpandedFolderIds,
} from './mobile-sidebar-expansion-state';

export function useMobileSidebarExpandedFolderIds(): {
  expandedFolderIds: ReadonlySet<string>;
  toggleFolder(folderId: string): void;
} {
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const expandedFolderIdsRef = React.useRef<ReadonlySet<string>>(expandedFolderIds);
  const loadedRef = React.useRef(false);
  const folderIdsTouchedBeforeLoadRef = React.useRef(new Set<string>());
  const persist = React.useCallback((folderIds: ReadonlySet<string>) => {
    void AsyncStorage.setItem(
      MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY,
      serializeMobileSidebarExpandedFolderIds(folderIds),
    ).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        const next = parseMobileSidebarExpandedFolderIds(stored);
        for (const folderId of folderIdsTouchedBeforeLoadRef.current) {
          if (expandedFolderIdsRef.current.has(folderId)) next.add(folderId);
          else next.delete(folderId);
        }
        expandedFolderIdsRef.current = next;
        loadedRef.current = true;
        setExpandedFolderIds(next);
        if (folderIdsTouchedBeforeLoadRef.current.size > 0) {
          persist(next);
          folderIdsTouchedBeforeLoadRef.current.clear();
        }
      })
      .catch(() => {
        if (!active) return;
        loadedRef.current = true;
        if (folderIdsTouchedBeforeLoadRef.current.size > 0) {
          persist(expandedFolderIdsRef.current);
          folderIdsTouchedBeforeLoadRef.current.clear();
        }
      });
    return () => {
      active = false;
    };
  }, [persist]);

  const toggleFolder = React.useCallback(
    (folderId: string) => {
      const normalizedFolderId = String(folderId ?? '').trim();
      if (!normalizedFolderId) return;
      const next = new Set(expandedFolderIdsRef.current);
      if (next.has(normalizedFolderId)) next.delete(normalizedFolderId);
      else next.add(normalizedFolderId);
      expandedFolderIdsRef.current = next;
      setExpandedFolderIds(next);
      if (loadedRef.current) persist(next);
      else folderIdsTouchedBeforeLoadRef.current.add(normalizedFolderId);
    },
    [persist],
  );

  return { expandedFolderIds, toggleFolder };
}
