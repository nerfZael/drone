import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOBILE_SIDEBAR_EXPANDED_FOLDER_IDS_STORAGE_KEY,
  parseMobileSidebarExpandedFolderIds,
  rewriteMobileSidebarExpandedFolderPrefix,
  serializeMobileSidebarExpandedFolderIds,
} from './mobile-sidebar-expansion-state';

export function useMobileSidebarExpandedFolderIds(): {
  expandedFolderIds: ReadonlySet<string>;
  toggleFolder(folderId: string): void;
  rewriteFolderPrefix(currentPrefix: string, nextPrefix: string): void;
  removeFolderPrefix(prefix: string): void;
} {
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const expandedFolderIdsRef = React.useRef<ReadonlySet<string>>(expandedFolderIds);
  const loadedRef = React.useRef(false);
  const folderIdsTouchedBeforeLoadRef = React.useRef(new Set<string>());
  const transformsBeforeLoadRef = React.useRef<Array<(folderIds: Set<string>) => Set<string>>>([]);
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
        let next = parseMobileSidebarExpandedFolderIds(stored);
        const hadPendingTransforms = transformsBeforeLoadRef.current.length > 0;
        for (const transform of transformsBeforeLoadRef.current) next = transform(next);
        for (const folderId of folderIdsTouchedBeforeLoadRef.current) {
          if (expandedFolderIdsRef.current.has(folderId)) next.add(folderId);
          else next.delete(folderId);
        }
        expandedFolderIdsRef.current = next;
        loadedRef.current = true;
        setExpandedFolderIds(next);
        if (folderIdsTouchedBeforeLoadRef.current.size > 0 || hadPendingTransforms) {
          persist(next);
          folderIdsTouchedBeforeLoadRef.current.clear();
        }
        transformsBeforeLoadRef.current = [];
      })
      .catch(() => {
        if (!active) return;
        loadedRef.current = true;
        if (
          folderIdsTouchedBeforeLoadRef.current.size > 0 ||
          transformsBeforeLoadRef.current.length > 0
        ) {
          persist(expandedFolderIdsRef.current);
          folderIdsTouchedBeforeLoadRef.current.clear();
          transformsBeforeLoadRef.current = [];
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

  const updateFolderIds = React.useCallback(
    (transform: (folderIds: Set<string>) => Set<string>) => {
      const next = transform(new Set(expandedFolderIdsRef.current));
      expandedFolderIdsRef.current = next;
      setExpandedFolderIds(next);
      folderIdsTouchedBeforeLoadRef.current = transform(
        new Set(folderIdsTouchedBeforeLoadRef.current),
      );
      if (loadedRef.current) persist(next);
      else transformsBeforeLoadRef.current.push(transform);
    },
    [persist],
  );

  const rewriteFolderPrefix = React.useCallback((currentPrefix: string, nextPrefix: string) => {
    const current = String(currentPrefix ?? '').trim();
    const next = String(nextPrefix ?? '').trim();
    if (!current || !next || current === next) return;
    updateFolderIds((folderIds) =>
      rewriteMobileSidebarExpandedFolderPrefix(folderIds, current, next));
  }, [updateFolderIds]);

  const removeFolderPrefix = React.useCallback((prefixRaw: string) => {
    const prefix = String(prefixRaw ?? '').trim();
    if (!prefix) return;
    updateFolderIds((folderIds) => new Set([...folderIds].filter((folderId) =>
      folderId !== prefix && !folderId.startsWith(`${prefix}/`))));
  }, [updateFolderIds]);

  return { expandedFolderIds, toggleFolder, rewriteFolderPrefix, removeFolderPrefix };
}
